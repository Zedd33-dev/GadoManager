# GadoManager

Sistema de gestão de rebanho bovino de corte — trabalho de conclusão de
curso (TCC). Multiusuário, multifazenda, com controle de acesso por cargo,
renderizado no servidor para funcionar em conexão fraca e sem depender de
JavaScript.

O projeto foi reconstruído do zero depois que o código-fonte original se
perdeu (ver [`docs/00-baseline-design.md`](docs/00-baseline-design.md) §0
para o relato completo) — o que também é a razão de este repositório trazer
uma documentação incomumente detalhada de decisões e evidências: cada uma
precisou ser refeita e justificada de novo.

## Por que olhar este projeto

- **Nenhuma senha em texto puro, nenhuma consulta SQL concatenada.** Argon2id
  para senhas; toda consulta usa parâmetros vinculados — impossibilidade
  estrutural, não convenção de estilo.
- **Isolamento entre contas de fazendas diferentes, verificado
  automaticamente em dois níveis**: no repositório e via HTTP real com
  sessão de login (`tests/integration/crossTenantAccess.test.js`), que prova
  que nenhuma conta alcança o registro de outra fazenda digitando um ID na
  URL.
- **Toda rota autorizada no servidor**, auditado por um teste que percorre a
  própria árvore de rotas do Express (`tests/integration/routeGuards.test.js`)
  em vez de confiar em alguém ter conferido isso manualmente.
- **Nenhum indicador confunde "sem dado" com "o valor é zero"** — a origem do
  sistema anterior ser reconstruído, ver `docs/00-baseline-design.md`.
- **407 testes automatizados** (`npm test`), a maioria provando uma
  propriedade específica (GMD exclui animal com uma só pesagem em vez de
  contar como zero; carência bloqueia venda; escopo de fazenda nunca vaza),
  não apenas "a função roda sem lançar exceção".

## Stack

Node.js + Express + EJS (renderizado no servidor, sem build) + SQLite
(`better-sqlite3`, um único arquivo) + Chart.js. Ver
[`docs/architecture.md`](docs/architecture.md) para a justificativa de cada
escolha.

## Como rodar

Pré-requisito: Node.js ≥ 20.11.

```bash
npm install
cp .env.example .env
# edite SESSION_SECRET em .env com um valor gerado por:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run migrate
npm run seed      # popula um rebanho de demonstração determinístico
npm run dev       # http://localhost:3000, reinicia sozinho a cada alteração
```

Contas criadas pelo seed (senha `Gado@2026` para todas):

| E-mail | Cargo | Fazendas |
| --- | --- | --- |
| `admin@gadomanager.com.br` | admin | Boa Vista, Santa Clara |
| `gerente@boavista.com.br` | gerente | Boa Vista |
| `gerente@santaclara.com.br` | gerente | Santa Clara |
| `peao@boavista.com.br` | peao | Boa Vista |

Para uma instalação limpa sem o dado de demonstração, crie o primeiro
administrador pela linha de comando em vez do seed:

```bash
node scripts/create-user.js --name "Seu Nome" --email voce@exemplo.com \
                             --role admin --password "uma-senha-forte"
```

Qualquer outra pessoa pode criar a própria conta em `/registrar` — ela nasce
como `gerente` sem nenhuma fazenda vinculada, e cadastra a própria fazenda
logo depois de entrar. Só o que alcança o sistema inteiro (gerenciar
usuários) ou é irreversível (excluir animal) continua exclusivo de um
administrador.

## Testes

```bash
npm test
```

Roda toda a suíte (`tests/unit/` e `tests/integration/`) com o executor de
testes nativo do Node — nenhuma dependência de teste no `package.json`.
Testes de integração migram um SQLite `:memory:` do zero a cada execução, ou
sobem um servidor Express real numa porta efêmera quando precisam de uma
sessão HTTP de verdade.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Camadas, ciclo de vida da requisição, multi-tenancy, autorização, segurança |
| [`docs/data-model.md`](docs/data-model.md) | Diagrama ER e dicionário de dados, extraídos do schema real |
| [`docs/business-rules.md`](docs/business-rules.md) | Cada fórmula (GMD, carência, arroba, taxa de lotação) com sua prova |
| [`docs/requirements.md`](docs/requirements.md) | Requisitos funcionais/não funcionais, atores, matriz de capacidades |
| [`docs/00-baseline-design.md`](docs/00-baseline-design.md) | O documento de planejamento original — histórico, mantido como registro do método, não atualizado depois |
| [`CHANGELOG.md`](CHANGELOG.md) | Uma entrada por fase/mudança: o que foi feito, por quê, e a evidência (medições, testes injetados de propósito) de que funciona |

## Dado provisório — leia antes de uma defesa

O calendário sanitário semeado (`seeds/demo.js`) e a UF das duas fazendas de
demonstração são **placeholders**, nunca validados contra bibliografia ou
legislação real — o sistema foi construído para que esse dado seja editável
pela interface (`/protocolos`) exatamente por causa disso, nunca fixado no
código. Ver `docs/00-baseline-design.md`, seção 6, para o registro completo
dessa decisão.

## Estrutura do projeto

```
src/           código da aplicação (rotas, serviços, repositórios, views)
public/        CSS e JavaScript de cliente (progressive enhancement)
migrations/    schema do banco, um arquivo .sql numerado por mudança
seeds/         dado de demonstração determinístico
tests/         unit/ e integration/
docs/          documentação listada acima
```

Detalhado em [`docs/architecture.md`](docs/architecture.md).
