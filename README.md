# Medidor de consumo

Painel web para acompanhar medições de energia de um ESP32, consultar o histórico de consumo e enviar comandos ao dispositivo. O servidor recebe a telemetria por MQTT, armazena as leituras no PostgreSQL e disponibiliza uma API HTTP para a interface.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Executar localmente](#executar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Integração MQTT](#integração-mqtt)
- [API HTTP](#api-http)
- [Tarifas e estimativas](#tarifas-e-estimativas)
- [Testes](#testes)
- [Manutenção e publicação](#manutenção-e-publicação)
- [Licença](#licença)

## Funcionalidades

- Exibição de tensão de entrada e de saída, corrente, potência e consumo acumulado.
- Histórico de potência e gráficos de consumo diário, dos últimos sete dias e do mês corrente.
- Consulta das ocorrências de potência acima do limite configurado.
- Configuração persistente do limite de pico e envio automático do comando de desligamento quando ele é excedido.
- Comandos para ligar, desligar e solicitar ajuste da tensão de saída.
- Estimativa de custos com tarifa informada manualmente ou selecionada por localidade e distribuidora.
- Tema claro/escuro com preferência salva no navegador e interface responsiva.

O firmware do ESP32 e o circuito do medidor não estão incluídos neste repositório. O dispositivo precisa implementar o contrato MQTT descrito abaixo.

## Arquitetura

```text
ESP32 ←→ Broker MQTT ←→ Servidor Node.js / Express ←→ PostgreSQL
                                 ↑
                              API HTTP
                                 ↓
                         Painel HTML / CSS / JS
```

| Camada | Tecnologias e responsabilidade |
| --- | --- |
| Interface | HTML, CSS e JavaScript; Chart.js para gráficos e Lucide para ícones |
| Servidor | Node.js, Express, CORS e dotenv |
| Comunicação com o dispositivo | Cliente MQTT |
| Persistência | PostgreSQL, acessado pelo pacote `pg` |
| Catálogo de tarifas | JSON local gerado a partir de dados da ANEEL e do IBGE |
| Verificação local | Checagem de sintaxe pelo Node.js (`npm run check`) |

O próprio Express serve a pasta `front-end`. Não há etapa de compilação da interface. Chart.js e Lucide são carregados por CDN conforme as referências em `index.html`.

## Estrutura do projeto

```text
Medidor-de-consumo/
├── front-end/
│   ├── index.html            # Estrutura da página e ordem de carregamento
│   ├── index.css             # Estilos, responsividade e cores dos temas
│   ├── theme.js              # Preferência de tema claro/escuro
│   ├── navigation.js         # Destaque da seção visível no menu
│   ├── controle-tensao.js    # Formulário e envio do ajuste de tensão
│   ├── custos.js             # Seleção de tarifa e apresentação dos custos
│   ├── api.js                # Endereço-base e construção das URLs da API
│   ├── formatacao.js         # Conversão numérica e apresentação de unidades
│   ├── graficos.js           # Criação, tema e atualização dos gráficos
│   ├── leituras.js           # Status, medições e histórico inicial de potência
│   ├── consumo.js            # Consultas de consumo e integração com custos
│   ├── picos.js              # Limite de potência, mensagens e lista de picos
│   ├── comandos.js           # Comandos de ligar/desligar e seu retorno visual
│   └── script.js             # Inicialização do painel e atualizações periódicas
├── data/
│   └── tarifas.json          # Catálogo de localidades, distribuidoras e tarifas
├── Back-end/
│   ├── servidor.js          # Inicialização e integração dos componentes
│   ├── configuracao.js      # Valores de ambiente e padrões do servidor
│   ├── banco.js             # Conexão, tabelas e persistência das leituras
│   ├── estado.js            # Estado compartilhado do medidor
│   ├── medicoes.js          # Validação e normalização da telemetria
│   ├── controle.js          # Comandos, disponibilidade e proteção de pico
│   ├── mqtt.js              # Eventos e recebimento de mensagens MQTT
│   ├── consumo.js           # Consulta SQL de consumo por período
│   ├── rotas.js             # Rotas HTTP de medições e controle
│   ├── tarifas.js           # Validação, vigência e rotas de tarifas
│   └── atualizar-tarifas.cjs # Importação do catálogo
├── server.js                 # Entrada compatível com o comando existente
├── package.json              # Dependências e comandos
├── package-lock.json         # Versões fixadas das dependências
├── .gitignore
└── README.md
```

### Organização dos scripts

Os arquivos extraídos de `script.js` continuam sendo **scripts clássicos**, compartilhando o escopo global. Isso preserva as funções usadas pelos botões do HTML e as referências entre os componentes, sem introduzir `import`, `export` ou um empacotador.

`theme.js` permanece no cabeçalho. No final da página, a ordem é:

```text
controle-tensao.js → custos.js → api.js → formatacao.js → graficos.js
→ leituras.js → consumo.js → picos.js → comandos.js → script.js → navigation.js
```

Mantenha essa ordem e o carregamento sequencial: `script.js` inicia as consultas após a definição das funções e a criação dos gráficos. Não adicione `async` às tags desses scripts.

| Atualização | Frequência atual |
| --- | --- |
| Medições e status | A cada 2 segundos |
| Consumo e picos | A cada 5 segundos |
| Revalidação da tarifa e recuperação do catálogo na interface | A cada 60 segundos |

Na inicialização, o painel consulta primeiro o limite de pico e, em seguida, carrega histórico, consumo, picos e status. A revalidação da interface consulta o servidor; ela não baixa um novo catálogo da ANEEL.

### Organização do backend

O código do servidor fica em `Back-end`, com módulos CommonJS carregados por `require`. `Back-end/servidor.js` cria as conexões, monta os componentes, registra os eventos e as rotas e inicializa o banco antes de abrir a porta HTTP.

`estado.js` cria um único objeto compartilhado entre MQTT, controle e rotas. Ele mantém a última leitura e os indicadores de leitura ao vivo, desarme por pico e ajuste em andamento. Essa referência compartilhada permite que as rotas enxerguem cada nova leitura e impede que a separação crie estados independentes do mesmo medidor.

O arquivo `server.js` na raiz apenas carrega `Back-end/servidor.js`. Assim, `npm start` e `node server.js` continuam válidos. O `.env`, a pasta `front-end` e o catálogo `data/tarifas.json` continuam na raiz. O arquivo antes localizado em `lib/tarifas.js` agora está em `Back-end/tarifas.js`, e o importador antes localizado em `scripts` também está em `Back-end`.

## Executar localmente

### Requisitos

- Node.js com npm. A reorganização foi validada com Node.js **24.15.0**.
- Uma instância PostgreSQL e um banco já criado, com usuário autorizado a criar/alterar as tabelas do aplicativo.
- Acesso ao broker MQTT usado pelo medidor.
- Navegador com acesso às CDNs de Chart.js e Lucide.

### Instalação

```bash
git clone https://github.com/RodolfoFerreira1480/Medidor-de-consumo.git
cd Medidor-de-consumo
npm ci
```

Crie um arquivo `.env` na raiz, ao lado de `server.js`. Exemplo para um ambiente local separado do medidor em produção:

```dotenv
PORT=3000
DATABASE_URL=postgresql://usuario:senha@localhost:5432/medidor
DB_SSL=false

MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC_DADOS=smart-meter/desenvolvimento/dados
MQTT_TOPIC_COMANDO=smart-meter/desenvolvimento/comando
MQTT_TOPIC_ALERTA=smart-meter/desenvolvimento/alerta

LIMITE_PICO_PADRAO=1000
```

Substitua os valores de exemplo pelos do seu ambiente. Esse exemplo pressupõe um broker local em execução; o projeto não inicia um broker. Configure o dispositivo de teste para usar os mesmos tópicos. O arquivo `.env` já está ignorado pelo Git.

```bash
npm start
```

Abra [http://localhost:3000](http://localhost:3000). O servidor cria ou complementa as tabelas `historico` e `configuracoes` na inicialização. O banco de dados em si deve existir previamente.

Sem telemetria, o painel pode abrir, mas não terá novas medições. O indicador de conexão do painel representa a resposta do servidor; a disponibilidade do ajuste de tensão também depende do MQTT e de uma leitura recente do dispositivo.

## Variáveis de ambiente

| Variável | Uso / valor padrão |
| --- | --- |
| `PORT` | Porta HTTP; padrão `3000` |
| `DATABASE_URL` | URL de conexão PostgreSQL; tem prioridade sobre os campos `DB_*` de conexão |
| `DB_HOST` | Host do PostgreSQL quando não há `DATABASE_URL` |
| `DB_PORT` | Porta do PostgreSQL; padrão `5432` |
| `DB_USER` | Usuário do PostgreSQL |
| `DB_PASSWORD` | Senha do PostgreSQL |
| `DB_DATABASE` | Nome do banco |
| `DB_SSL` | `true` ativa TLS; `false` desativa; ausente usa detecção de Render/Supabase |
| `DB_SSL_CA` | Certificado CA opcional; aceita quebras de linha representadas por `\n` |
| `RENDER` | Indicador de ambiente usado pelo código para exigir uma conexão configurada e ativar TLS por padrão |
| `MQTT_BROKER` | Padrão `mqtt://broker.hivemq.com:1883` |
| `MQTT_TOPIC_DADOS` | Padrão `smart-meter/medidor/dados` |
| `MQTT_TOPIC_COMANDO` | Padrão `smart-meter/medidor/comando` |
| `MQTT_TOPIC_ALERTA` | Padrão `smart-meter/medidor/alerta` |
| `LIMITE_PICO_PADRAO` | Limite inicial em watts; padrão `1000`, substituído pelo valor salvo no banco quando disponível |

Quando TLS está ativo, o código verifica o certificado do servidor. Para conexões que dependam de uma CA específica, configure `DB_SSL_CA`.

## Integração MQTT

### Telemetria

O servidor assina o tópico definido em `MQTT_TOPIC_DADOS`. Exemplo de mensagem JSON:

```json
{
  "tensao": 24,
  "tensaoSaida": 12.5,
  "tensaoMaxima": 24,
  "corrente": 2,
  "potencia": 25,
  "consumoKWh": 1.2345
}
```

Tensões são expressas em volts, corrente em amperes, potência em watts e consumo acumulado em kWh. O servidor atribui o horário de recebimento à leitura.

Também são aceitos `tensao_saida`, `tensao_maxima` e os aliases de consumo `consumoKwh`, `consumokwh` e `consumo_kwh`. Quando a potência não é informada de forma válida, o servidor a calcula a partir da tensão de saída disponível (ou da entrada) multiplicada pela corrente.

### Comandos e alertas

O servidor publica no tópico `MQTT_TOPIC_COMANDO`, com QoS 1 e `retain: false`:

```json
{ "comando": "ligar" }
```

```json
{ "comando": "desligar" }
```

```json
{ "comando": "ajustar_tensao", "tensaoSaida": 12.5 }
```

O ajuste exige conexão MQTT, telemetria não retida recebida nos últimos 15 segundos e uma tensão máxima positiva informada pelo ESP32. O valor solicitado deve estar entre zero e essa tensão máxima. A confirmação da API indica o envio ao broker; a tensão efetivamente aplicada é verificada pelas medições seguintes.

O tópico `MQTT_TOPIC_ALERTA` recebe uma mensagem de texto usada como alerta. A proteção automática publica `desligar` quando a potência ultrapassa o limite e evita repetir o desarme até a potência cair para, no máximo, 95% desse limite.

## API HTTP

As rotas usam o prefixo `/api`. Requisições POST recebem JSON com `Content-Type: application/json`.

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/status` | Última leitura e disponibilidade do ajuste de tensão |
| GET | `/api/historico` | Últimas 50 leituras, em ordem cronológica |
| GET | `/api/consumo-diario` | Consumo do dia agrupado por hora |
| GET | `/api/consumo-semanal` | Consumo dos últimos sete dias, incluindo hoje |
| GET | `/api/consumo-mensal` | Consumo do mês corrente agrupado por dia |
| GET | `/api/picos` | Picos de hoje acima do limite e limite atual |
| GET | `/api/config/limite` | Limite de potência salvo |
| POST | `/api/config/limite` | Salva `{ "novoLimite": 1000 }` |
| POST | `/api/comando` | Envia `{ "acao": "ligar" }` ou `{ "acao": "desligar" }` |
| POST | `/api/tensao-saida` | Solicita `{ "tensaoSaida": 12.5 }` |
| GET | `/api/tarifas/estados` | Estados e informação da fonte do catálogo |
| GET | `/api/tarifas/municipios?uf=SP` | Municípios do estado |
| GET | `/api/tarifas/distribuidoras?uf=SP&municipio=3550308` | Distribuidoras com tarifa vigente; município opcional |
| GET | `/api/config/tarifa` | Configuração e tarifa efetiva salvas |
| POST | `/api/config/tarifa` | Salva tarifa manual ou por localidade |

Exemplos de corpo para configuração da tarifa:

```json
{ "modo": "manual", "valorKWh": 0.85 }
```

```json
{
  "modo": "localidade",
  "uf": "SP",
  "municipio": "3550308",
  "distribuidoraId": "<id retornado pela consulta de distribuidoras>"
}
```

As agregações de consumo usam as diferenças entre leituras acumuladas, com tratamento para reinício do contador. As fronteiras de dia e mês seguem o fuso da sessão PostgreSQL. A vigência das tarifas usa `America/Sao_Paulo`.

## Tarifas e estimativas

O catálogo versionado em `data/tarifas.json` contém localidades, cobertura das distribuidoras e tarifas residenciais B1 convencionais. A estimativa usa:

```text
custo estimado = consumo do período em kWh × tarifa salva em R$/kWh
```

A tarifa salva é aplicada a todo o período, sem reconstruir reajustes históricos. Os valores da ANEEL somam TE e TUSD e não incluem impostos, bandeiras tarifárias ou iluminação pública. O resultado não representa a conta final. O modo manual aceita valores maiores que zero e até R$ 100/kWh, com até seis casas decimais.

Para atualizar o catálogo a partir das fontes oficiais:

```bash
npm run tarifas:atualizar
```

Para gerar um arquivo separado para revisão:

```bash
npm run tarifas:atualizar -- data/tarifas-revisao.json
```

O importador valida cobertura e conflitos antes de substituir o arquivo de destino. Revise o resultado antes de incorporá-lo ao projeto. Como o servidor carrega o catálogo na memória, reinicie a aplicação após publicar uma atualização desse arquivo. Não há agendamento automático de importação no repositório.

## Testes

Esta cópia V1.1 não inclui a pasta `tests`. Os comandos abaixo verificam a sintaxe de todos os arquivos JavaScript da aplicação, sem abrir conexões com o banco ou enviar comandos MQTT:

```bash
npm run check
```

`npm test` executa a mesma checagem. Essa verificação detecta erros de sintaxe; ela não é uma suíte de testes de comportamento nem substitui a validação em homologação.

A reorganização foi validada em uma cópia isolada com 69 testes automatizados, incluindo comparação entre as versões anterior e organizada para inicialização, rotas, SQL, estado compartilhado, telemetria, proteção, falhas do banco e tarifas. As integrações externas foram simuladas, sem conexão com o medidor real.

## Manutenção e publicação

Use `npm ci` para instalar as versões do arquivo de dependências e `npm start` para iniciar o servidor. O diretório raiz do serviço deve conter `server.js`, `Back-end`, `front-end` e `data`. Configure as variáveis de ambiente no serviço de hospedagem; não é necessário compilar o frontend.

Para publicar esta organização, entregue o `server.js`, a pasta `Back-end`, o `package.json` e todos os arquivos de `front-end` na mesma versão. O `script.js` agora contém somente a inicialização e depende dos arquivos extraídos. Em caso de reversão, restaure a versão completa anterior do projeto.

Faça a validação em um ambiente separado antes de substituir a versão em operação. Uma instância de desenvolvimento conectada aos tópicos do medidor real também executa a proteção automática do servidor.

### Diagnóstico rápido

| Sintoma | O que verificar |
| --- | --- |
| Painel sem conexão | Processo Node.js, porta configurada e resposta de `/api/status` |
| Histórico indisponível | Conexão, credenciais e permissões do PostgreSQL nos logs do servidor |
| Gráficos ou ícones ausentes | Carregamento das CDNs e dos scripts locais no navegador |
| Ajuste de tensão bloqueado | MQTT conectado, leitura recente não retida e `tensaoMaxima` positiva |
| Custos exibidos como `—` | Tarifa salva e vigente, acesso à API e leituras disponíveis no período |
| Nenhuma tarifa na localidade | Vigência do catálogo, distribuidora selecionada e necessidade de atualizar a base |

## Licença

O campo `license` de `package.json` declara **ISC**. O repositório não inclui um arquivo `LICENSE` separado. O catálogo registra suas fontes e a referência de licença dos dados da ANEEL em `data/tarifas.json`.
