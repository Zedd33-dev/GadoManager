# Arquitetura

Como o GadoManager é construído por dentro: as camadas, o ciclo de vida de
uma requisição, o modelo de autorização e as decisões que moldaram tudo
isso. Para as fórmulas de negócio (GMD, carência, arroba, taxa de lotação),
ver [`business-rules.md`](business-rules.md). Para o schema completo, ver
[`data-model.md`](data-model.md).

---

## Pilha tecnológica

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Runtime | Node.js (≥ 20.11) | Uma única linguagem no servidor inteiro; nenhum runtime adicional para instalar na máquina de um examinador. |
| HTTP | Express 4 | O framework web mais documentado do Node. A cadeia de middleware é explícita e cabe inteira numa lista, não escondida atrás de convenção. |
| Banco de dados | SQLite via `better-sqlite3` | Sem instalação, um único arquivo, totalmente reproduzível — o `.db` é copiado junto com o projeto. Nenhum processo de servidor de banco para configurar numa defesa. |
| Acesso a dados | SQL parametrizado + camada de repositório | Statements preparados com parâmetros vinculados tornam injeção de SQL impossível por construção, não por revisão. |
| Migrações | Arquivos `.sql` numerados + um runner de ~150 linhas | O histórico do schema é SQL legível, não um artefato gerado. |
| Views | EJS renderizado no servidor | Sem etapa de build, sem bundler, sem framework de cliente. A página chega completa; funciona em conexão fraca e sem JavaScript. |
| Gráficos | Chart.js, servido do próprio `node_modules` | Nunca depende de CDN. |
| Autenticação | `express-session` + `better-sqlite3-session-store` + Argon2id | Argon2id é a recomendação atual para hash de senha; sessões no mesmo SQLite mantêm a história de "um arquivo só" no deploy. |
| Testes | `node:test` nativo | Zero dependências de teste. |

---

## Camadas

```
rotas → serviços → repositórios → SQLite
```

- **Rotas** (`src/routes/`) são finas: leem `req`, chamam um serviço de
  validação, chamam um repositório, renderizam uma view ou redirecionam. Não
  contêm SQL nem aritmética de negócio.
- **Serviços** (`src/services/`) contêm as regras de negócio. Recebem dados
  simples e devolvem dados simples — sem `req`/`res`, sem SQL. É isso que
  torna GMD, carência e taxa de lotação testáveis por unidade sem precisar
  de um banco de dados.
- **Repositórios** (`src/repositories/`) são o único lugar onde uma string
  SQL pode existir. Toda consulta é preparada com parâmetros vinculados; ver
  `middleware/tenant.js#inClause` para como uma lista de IDs de fazenda vira
  um `IN (?, ?, ...)` sem nunca concatenar valor nenhum na string.
- **Domain** (`src/domain/`) guarda funções puras e constantes
  (`ARROBA_KG = 15`, `UA_KG = 450`, a matriz de capacidades por cargo).

Essa separação é o que permite que cada KPI do painel seja um método de
repositório nomeado com uma consulta inspecionável, mais uma função de
serviço com teste de unidade — não uma fórmula espalhada entre view e rota.

---

## Ciclo de vida de uma requisição

Ordem real de `src/app.js`, cada estágio depende do anterior:

```
requisição
  → helmet (cabeçalhos de segurança, CSP restrita a 'self')
  → parsing do corpo (urlencoded + multipart)
  → arquivos estáticos (/static)
  → sessão (armazenada no mesmo SQLite)
  → loadUser (relê a conta do banco a cada requisição — ver nota abaixo)
  → flash (mensagens de uma exibição só)
  → csrfToken / verifyCsrf (métodos que mudam estado)
  → resolveTenantScope (calcula req.scope.effectiveFarmIds)
  → rotas públicas (login, registro, healthcheck)
  → requireLogin
  → rotas de gestão de usuários (users:manage — não depende de fazenda)
  → rotas com escopo de fazenda (tudo mais)
  → tratamento de erros (404 / 500)
```

**`loadUser` relê o usuário do banco em toda requisição**, em vez de confiar
no que a sessão guardou. É por isso que desativar uma conta ou trocar seu
cargo tem efeito imediato — não espera a próxima vez que a pessoa fizer
login. Se a conta não existe mais ou foi desativada, a sessão é destruída na
hora.

---

## Multi-tenancy

O isolamento entre contas de fazendas diferentes não é uma regra espalhada
pelas rotas — é uma única tabela (`user_farms`) e uma única função
(`resolveTenantScope`) que a lê em toda requisição autenticada, produzindo
`req.scope.effectiveFarmIds`. Todo repositório que toca dado pertencente a
uma fazenda recebe essa lista como parâmetro vinculado; não existe caminho
de código que leia dado de animal sem ela.

Uma lista vazia (usuário sem nenhuma fazenda concedida) compila para
`IN (NULL)`, que não corresponde a nenhuma linha em SQLite — o caso
degenerado mais seguro possível, sem precisar de um `if` especial em cada
consulta. Uma conta recém-criada (auto-registro) nasce exatamente nesse
estado: navega o site normalmente, mas todas as listas aparecem vazias e
todo indicador aparece zerado — até ela mesma cadastrar uma fazenda. O
cargo `gerente` concedido no registro já inclui `farms:write`
especificamente por isso: criar uma fazenda concede acesso a ela ao próprio
criador na mesma transação (`farmRepository.insertFarmForUser`), então uma
conta nova não precisa esperar por um administrador para ter o que gerir —
só não alcança o que é do sistema inteiro (`users:manage`) ou irreversível
(`animals:delete`), que continuam exclusivos de `admin`.

Isso é verificado automaticamente, não apenas assumido:

- `tests/integration/tenantIsolation.test.js` — prova no nível de
  repositório que a cláusula de escopo é gerada a partir do *tamanho* da
  lista de IDs, nunca do seu conteúdo (então um ID de fazenda hostil não
  pode ser injetado como SQL).
- `tests/integration/crossTenantAccess.test.js` — prova no nível de HTTP
  real, com sessão de login real, que uma conta não alcança o registro de
  outra fazenda digitando um ID na URL (IDOR). Ver a seção seguinte para por
  que isso precisa ser testado nas duas camadas.

---

## Autorização por capacidade

Cada cargo (`admin`, `gerente`, `peao`) não é checado com
`if (user.role === 'admin')` espalhado pelas rotas — existe uma matriz
única em `src/domain/permissions.js` mapeando **capacidade → cargos
permitidos** (`'sales:write': ['admin', 'gerente']`, por exemplo). Toda rota
que muda ou revela dado sensível é decorada com
`requireCapability('alguma:capacidade')`, que:

1. Nega fechado — uma capacidade com nome errado ou inexistente nega **todo
   mundo**, inclusive administradores, em vez de abrir uma brecha.
2. É verificada antes de qualquer handler rodar — esconder um botão na tela
   é apresentação, não controle de acesso; a decisão real está sempre no
   servidor.

Essa afirmação — "toda rota tem uma capacidade, e a capacidade existe de
verdade" — é auditada automaticamente por
`tests/integration/routeGuards.test.js`, que percorre a própria árvore de
rotas do Express em vez de confiar em alguém ter conferido isso manualmente
da última vez. O teste também rejeita um `POST` protegido só por uma
capacidade de leitura (`:read`), que um peão sempre possui, e que
permitiria a um peão executar uma ação de escrita que o cargo nunca deveria
ter.

---

## Segurança

| Preocupação | Mecanismo |
| --- | --- |
| Injeção de SQL | Impossível por construção — toda consulta é `db.prepare(...).run/get/all(...)` com parâmetros vinculados; nenhuma string SQL é montada por concatenação em lugar nenhum do projeto. |
| Senhas | Argon2id (`@node-rs/argon2`), parâmetros OWASP explícitos. Login compara com um hash-isca mesmo quando o e-mail não existe, para que a resposta não vaze por tempo se a conta existe. |
| CSRF | Padrão *synchronizer token*: um token por sessão, verificado em todo método que muda estado. |
| XSS | EJS escapa por padrão (`<%= %>`); a única saída não escapada (`<%- %>`) é usada para HTML já de confiança (partials, JSON embutido escapado à mão em `lib/safeJson.js`). |
| Sessão | Cookie `httpOnly`, `sameSite=lax`, `secure` em produção; ID regenerado no login (contra fixação de sessão). |
| Cabeçalhos | Helmet com CSP restrita a `'self'` — nada de CDN, nada de `unsafe-inline`, o que também é por que não existe `onclick=""` em nenhuma view; todo comportamento interativo mora em `public/js/*.js`. |
| Upload de arquivo | Foto do animal validada por *magic bytes* (não pela extensão do nome), armazenada fora do webroot, servida só por rota autenticada e com escopo de fazenda. |
| Autorização | Ver seção anterior — negação fechada, auditada automaticamente. |
| Isolamento entre contas | Ver seção anterior — verificado tanto no repositório quanto via HTTP real. |

---

## Estrutura de diretórios

```
src/
├─ server.js          bootstrap + listen
├─ app.js              monta o app Express e a cadeia de middleware
├─ config/             env.js, db.js — leitura de ambiente e conexão SQLite
├─ middleware/         auth, csrf, tenant, session, flash, upload, errors
├─ routes/             uma rota fina por módulo; nenhum SQL aqui
├─ services/           regras de negócio; funções puras testáveis
├─ repositories/       todo SQL do projeto vive aqui, e só aqui
├─ domain/             constantes e a matriz de capacidades
├─ lib/                format.js, safeMath.js, dates.js, csv.js, pagination.js...
└─ views/              EJS: partials/, e uma pasta por módulo
public/
├─ css/app.css          um único design system, variáveis CSS para tema claro/escuro
└─ js/                  progressive enhancement — cada tela funciona sem JS
migrations/             *.sql numerados, aplicados uma vez, nunca editados depois
seeds/demo.js           dado de demonstração determinístico (PRNG com seed fixa)
tests/{unit,integration}/
```

---

## Modo escuro

Duas entradas: preferência do sistema operacional
(`prefers-color-scheme`) e escolha explícita persistida em `localStorage`,
aplicada por um script síncrono no `<head>` antes da primeira pintura da
página — evita o "flash" do tema errado. Todas as cores vivem em variáveis
CSS (`public/css/app.css`); nenhuma cor é redeclarada duas vezes.

Uma exceção real que apareceu durante o desenvolvimento: Chart.js desenha
em `<canvas>`, que não enxerga uma variável CSS mudar depois de desenhado —
por isso os scripts de gráfico leem a cor computada (`getComputedStyle`) no
momento da criação do gráfico, e o botão de alternar tema **recarrega a
página** em vez de só trocar o atributo, para que todo gráfico já nasça
com a cor certa do tema novo. Ver `CHANGELOG.md` para o relato completo
desse bug e da correção.

---

## Testes

Sem framework de teste externo — `node:test` (nativo desde o Node 18) mais
`node:assert/strict`. Duas pastas:

- **`tests/unit/`** — funções de serviço puras (GMD, carência, arroba,
  validação de formulário), sem banco de dados.
- **`tests/integration/`** — contra um SQLite `:memory:` migrado do zero a
  cada teste (`tests/helpers/testDb.js`), ou contra um servidor Express real
  ouvindo numa porta efêmera para os testes que precisam de sessão/cookie
  HTTP de verdade (`crossTenantAccess.test.js`).

A disciplina seguida em todo o projeto: quando um teste falha, investigar
com um script isolado *antes* de concluir que é bug da aplicação — isso já
evitou "consertar" código correto por causa de um teste malfeito mais de
uma vez (ver `CHANGELOG.md`, Fase 11, para dois exemplos reais). E quando um
teste novo é escrito especificamente para travar uma propriedade de
segurança, ele só conta como evidência depois de comprovado que consegue
falhar — ver Fase 12: cinco bugs foram injetados de propósito, um de cada
vez, e cada um foi pego pela asserção esperada antes de ser revertido.

---

## Decisões que valem uma pergunta de banca

- **Por que SQLite e não PostgreSQL/MySQL?** Zero instalação, um arquivo
  copiável, reproduzível na máquina de qualquer examinador sem configurar
  um servidor de banco. O custo — sem conexões concorrentes de verdade — é
  irrelevante na escala de uma ou duas fazendas.
- **Por que EJS e não React/Vue?** Sem etapa de build, funciona em conexão
  fraca e sem JavaScript habilitado (uso a campo é uma premissa do
  projeto). Toda tela é HTML completo na primeira resposta; JavaScript é
  progressive enhancement, nunca requisito.
- **Por que uma tabela para Vacinas e Tratamentos?** Ver
  `data-model.md#health_events` — as colunas, a regra de atraso e a regra
  de carência são idênticas; duas tabelas significariam duas cópias da
  mesma consulta, e divergência entre cópias foi a hipótese líder para a
  anomalia original do sistema.
- **Por que o calendário sanitário é editável em vez de fixo?** Porque ele
  depende de UF e legislação, que o time do projeto não tem como validar
  sem a bibliografia certa — fixá-lo no código seria inventar conhecimento
  de domínio. Os dados de exemplo são rotulados como provisórios na própria
  interface.
- **Por que raça é texto livre?** Era uma lista fechada de três raças
  (Nelore/Angus/Cruzado) até a migração 005 — restrição correta para o
  rebanho de demonstração, errada como regra geral. Ver `CHANGELOG.md` para
  o relato completo, incluindo um bug real de perda de dados encontrado e
  corrigido durante essa mudança de schema.
