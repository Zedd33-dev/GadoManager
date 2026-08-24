# Requisitos

## 1. Visão geral

GadoManager é um sistema de gestão de rebanho bovino de corte, multiusuário
e multifazenda, voltado a produtores e suas equipes de campo. Substitui um
sistema anterior cujo código-fonte foi perdido (ver
`docs/00-baseline-design.md` §0) e cujos defeitos relatados — indicadores do
painel com números impossíveis, ausência de controle de acesso real,
interface não usável em campo — motivaram a reconstrução do zero descrita
neste repositório.

## 2. Atores

| Ator | Descrição |
| --- | --- |
| **Administrador** (`admin`) | Dono ou responsável geral. Único que gerencia usuários, cadastra fazendas e exclui animais permanentemente. |
| **Gerente** (`gerente`) | Responsável operacional de uma ou mais fazendas. Cadastra e edita animais, lança vendas e custos, define o calendário sanitário. |
| **Peão** (`peao`) | Equipe de campo. Registra o que acontece no dia a dia — pesagens, aplicação de doses já agendadas, conclusão de lembretes — mas não decide política (não cadastra animal, não lança venda, não define protocolo). |
| **Visitante não autenticado** | Só alcança `/login` e `/registrar`. |

Uma conta pode pertencer a mais de uma fazenda (tabela `user_farms`); o
acesso é por concessão explícita, nunca implícito.

## 3. Requisitos funcionais

Cada linha aponta o módulo que a implementa, para rastreabilidade.

### RF01 — Autenticação e contas
- RF01.1 Um visitante pode criar uma conta (`/registrar`), que nasce como
  `gerente` sem nenhuma fazenda vinculada. Sem fazenda ainda não é sem
  função: a própria conta cadastra sua fazenda (`farms:write` inclui
  gerente) e, a partir daí, opera sozinha — lotes, pastos, animais, vendas,
  custos — sem depender de um administrador. Continua impossível se
  autoconceder `admin` (gestão de usuários, exclusão permanente) pelo
  cadastro.
- RF01.2 Login por e-mail/senha, com Argon2id e sem distinguir "e-mail não
  existe" de "senha errada" na mensagem de erro.
- RF01.3 Uma conta desativada perde a sessão já aberta na requisição
  seguinte, não apenas no próximo login.
- RF01.4 Um administrador gerencia contas (`/usuarios`): troca de cargo,
  concessão/revogação de fazenda por checkbox, ativar/desativar. Não é
  possível a um administrador rebaixar ou desativar a própria conta.

### RF02 — Estrutura da fazenda
- RF02.1 Cadastro de fazendas, lotes e pastos.
- RF02.2 Lote e pasto nunca são excluídos, apenas desativados — preservam o
  histórico de animais que já passaram por eles. Desativar é recusado
  enquanto o registro ainda tiver ocupantes.

### RF03 — Animais
- RF03.1 Cadastro com brinco (único por fazenda, não globalmente), SISBOV
  opcional, raça em **texto livre** (qualquer raça ou cruzamento, com
  sugestões conhecidas apenas como atalho de digitação), sexo, origem
  (nascido/comprado), mãe (para nascidos na fazenda).
- RF03.2 Listagem com busca, filtros, ordenação, paginação e exportação CSV
  — infraestrutura reutilizada por todo módulo de listagem do sistema.
- RF03.3 Ficha do animal com linha do tempo (pesagens, doses, movimentações)
  e curva de peso.
- RF03.4 Upload de foto, validado pelo conteúdo real do arquivo (não pela
  extensão do nome), servida apenas por rota autenticada e com escopo de
  fazenda.
- RF03.5 Exclusão em massa (apenas administrador) — a única operação
  verdadeiramente destrutiva do sistema.
- RF03.6 Busca global por brinco, disponível no cabeçalho em qualquer tela.

### RF04 — Pesagens
- RF04.1 Lançamento individual e em lote (entrada por teclado, brinco → Tab
  → peso → Enter, sem precisar do mouse).
- RF04.2 Detecção de outlier: uma perda de peso acima de um limiar relativo
  ao tamanho do animal é sinalizada, não silenciosamente aceita.
- RF04.3 GMD (ganho médio diário) calculado a partir das duas pesagens mais
  recentes; um animal com uma única pesagem é **excluído** do cálculo, não
  contado como zero.

### RF05 — Sanidade (Vacinas e Tratamentos)
- RF05.1 Protocolos sanitários editáveis pela interface (`/protocolos`) —
  dado, não conhecimento fixado no código. Ver `docs/architecture.md` para
  a justificativa.
- RF05.2 Agendamento de doses a partir de um protocolo, por idade ou por
  data.
- RF05.3 Aplicação de dose agendada, com registro de quem aplicou e quando.
- RF05.4 Cálculo de período de carência a partir da **data de aplicação**
  (não da data prevista), com a data de liberação do animal calculada e
  exibida; sobreposição de produtos usa a liberação mais tardia.
- RF05.5 Painel de alertas reportando doses atrasadas **e** a população de
  animais afetada juntas (nunca um número solto sem o denominador).

### RF06 — Movimentações
- RF06.1 Mudança de lote/pasto/fazenda registrada como histórico auditável,
  com a localização atual do animal atualizada na mesma transação.

### RF07 — Vendas
- RF07.1 Venda de um ou mais animais a um comprador, com peso vivo,
  rendimento de carcaça e preço por arroba negociado.
- RF07.2 Um animal sob carência não pode ser vendido — bloqueado tanto na
  interface (checkbox desabilitado) quanto no servidor (validação
  autoritativa).
- RF07.3 Lucro estimado por animal vendido, com o custo acumulado
  explicitamente rotulado como **estimativa** (alocação de custo médio, não
  rastreamento exato por lote).

### RF08 — Custos
- RF08.1 Lançamento por categoria fixa (alimentação, sanidade, mão de obra,
  infraestrutura, outros), por fazenda ou por lote.
- RF08.2 Custo recorrente expande-se em ocorrências independentes no
  cadastro; excluir uma não afeta as demais.

### RF09 — Lembretes
- RF09.1 Cadastro com data de vencimento e recorrência (semanal, mensal,
  anual) avançando por calendário, não por contagem fixa de dias.
- RF09.2 Widget de próximos lembretes no painel.

### RF10 — Painel e relatórios
- RF10.1 Indicadores-chave (rebanho por status, peso médio, GMD médio,
  alertas sanitários, custos do mês) com filtro por fazenda, lote, status e
  período persistido na URL.
- RF10.2 Todo indicador distingue "sem dado" de "o valor é zero" — nunca
  renderiza `R$ 0,00` quando na verdade não houve nenhum lançamento.
- RF10.3 Gráficos (Chart.js) com tabela de dados equivalente ao lado, para
  quem não pode depender do gráfico.
- RF10.4 Relatório do rebanho imprimível (`/relatorios/rebanho`), reaproveitando
  os mesmos cálculos do painel — nunca uma segunda forma de calcular a
  mesma métrica.

### RF11 — Aparência
- RF11.1 Tema claro/escuro, seguindo a preferência do sistema operacional
  por padrão, com alternância manual persistida.
- RF11.2 Interface responsiva: tabela vira cartão empilhado abaixo de
  768px, navegação atrás de um menu hambúrguer.

## 4. Requisitos não funcionais

| ID | Requisito | Como é atendido |
| --- | --- | --- |
| RNF01 | Instalação sem servidor de banco externo | SQLite em arquivo único (`better-sqlite3`) |
| RNF02 | Funcionar em conexão fraca / sem JavaScript | Renderização no servidor (EJS); todo formulário funciona sem JS, que é só *progressive enhancement* |
| RNF03 | Usável a campo, inclusive no celular e com luvas | Alvo de toque mínimo de 44px em todo controle interativo; paleta de alto contraste pensada para uso ao ar livre |
| RNF04 | Nenhuma senha em texto puro | Argon2id, parâmetros OWASP explícitos |
| RNF05 | Nenhuma consulta SQL montada por concatenação | Toda consulta usa `db.prepare(...)` com parâmetros vinculados — impossibilidade estrutural, não regra de estilo |
| RNF06 | Isolamento entre contas de fazendas diferentes | `req.scope.effectiveFarmIds` vinculado em toda consulta; verificado automaticamente em dois níveis (repositório e HTTP real) — ver `docs/architecture.md#multi-tenancy` |
| RNF07 | Toda ação de escrita autorizada no servidor, não só escondida na tela | `requireCapability(...)` em toda rota, auditado automaticamente |
| RNF08 | Acessibilidade (WCAG AA) | Paleta com contraste auditado (documentado em `app.css`), navegação por teclado, rótulos ARIA, tabela alternativa a todo gráfico |
| RNF09 | Reprodutibilidade do ambiente de demonstração | `seeds/demo.js` usa PRNG com semente fixa — a mesma base de dados de demonstração nasce idêntica em qualquer máquina |
| RNF10 | Formatação pt-BR consistente | Centralizada em `src/lib/format.js` (datas `dd/MM/yyyy`, moeda com vírgula decimal); nenhuma view formata data ou dinheiro por conta própria |

## 5. Matriz de capacidades

Fonte da verdade: `src/domain/permissions.js`. "Leitura" e "escrita" aqui
são as capacidades reais verificadas por `requireCapability`, não uma
aproximação — e a correspondência entre esta tabela e o código é verificada
automaticamente por `tests/integration/routeGuards.test.js`.

| Capacidade | Admin | Gerente | Peão |
| --- | :---: | :---: | :---: |
| Ver painel, animais, pesagens, sanidade, lembretes | ✅ | ✅ | ✅ |
| Registrar pesagem | ✅ | ✅ | ✅ |
| Aplicar dose já agendada | ✅ | ✅ | ✅ |
| Concluir lembrete | ✅ | ✅ | ✅ |
| Cadastrar/editar animal | ✅ | ✅ | ❌ |
| Agendar dose, editar protocolo sanitário | ✅ | ✅ | ❌ |
| Registrar movimentação | ✅ | ✅ | ❌ |
| Cadastrar/editar lote, pasto | ✅ | ✅ | ❌ |
| Criar/editar lembrete | ✅ | ✅ | ❌ |
| Ver e lançar vendas | ✅ | ✅ | ❌ |
| Ver e lançar custos | ✅ | ✅ | ❌ |
| Cadastrar/editar fazenda | ✅ | ✅ | ❌ |
| Excluir animal (permanente) | ✅ | ❌ | ❌ |
| Gerenciar usuários (cargo, acesso a fazenda, ativar/desativar) | ✅ | ❌ | ❌ |

A lógica por trás da coluna do peão: ele registra o que acontece no campo,
mas não decide política — não cadastra um animal, não lança uma venda, não
muda o calendário sanitário. Vendas e custos são dado financeiro/comercial,
fora do escopo de quem trabalha a campo.

A lógica por trás do gerente ter "Cadastrar/editar fazenda": é o cargo dado
a uma conta recém-criada por autocadastro (RF01.1), especificamente para
que ela consiga montar sua própria operação sem depender de um
administrador já existente. O que continua exclusivo do admin é o que
alcança o sistema inteiro (gerenciar qualquer usuário) ou é irreversível
(excluir um animal permanentemente) — nunca a estrutura da própria fazenda
de quem acabou de se cadastrar.

## 6. Fora de escopo (decisão deliberada)

- **Módulo de reprodução.** Nascimento é representado como uma flag de
  origem (`nascido`/`comprado`) mais uma referência opcional à mãe — não há
  cobertura, prenhez ou genealogia detalhada.
- **Suporte offline.** O sistema pressupõe uma conexão, ainda que fraca; não
  há fila de sincronização nem *service worker*.
- **Gado leiteiro.** O sistema cobre exclusivamente pecuária de corte.
- **Febre aftosa no calendário sanitário de demonstração**, por ser um
  anacronismo desde que o Brasil foi reconhecido livre da doença sem
  vacinação — ver `docs/00-baseline-design.md`, seção 6, questão 3. Qualquer
  protocolo real segue editável em `/protocolos`, o que não é uma limitação
  do sistema, apenas uma escolha sobre o dado semeado.
