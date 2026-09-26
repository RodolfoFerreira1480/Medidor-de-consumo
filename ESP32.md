# Controle da tensão de saída

O painel mantém a leitura de tensão separada do valor solicitado. O envio ao
broker MQTT não confirma que o ESP32 aplicou a tensão. A confirmação visual vem
da leitura `tensaoSaida` enviada pelo equipamento.

**O firmware do ESP32 não está neste repositório e precisa ser conferido com o
responsável pelo medidor.** Este é o contrato implementado no site e servidor.

## Telemetria do ESP32

Publique no tópico configurado em `MQTT_TOPIC_DADOS` (padrão
`smart-meter/medidor/dados`), idealmente a cada 2 segundos, sem `retain`:

```json
{
  "tensao": 24,
  "tensaoSaida": 12.5,
  "tensaoMaxima": 24,
  "corrente": 1.2,
  "potencia": 15,
  "consumoKWh": 0.031
}
```

`tensaoMaxima` é o limite de saída atualmente permitido pelo equipamento, em
volts, e deve acompanhar **cada leitura**. Não é o pico histórico de tensão.
Também são aceitos `tensao_maxima` e `tensao_saida`. São aceitos números e strings
numéricas não vazias. O máximo precisa ser positivo e finito; zero é uma leitura
válida para a saída. Ausência ou valor inválido de máximo aparece como “—” e
bloqueia o ajuste. Payloads antigos continuam funcionando para as demais leituras.

## Comando recebido pelo ESP32

O ESP32 deve assinar `MQTT_TOPIC_COMANDO` (padrão
`smart-meter/medidor/comando`) e tratar:

```json
{ "comando": "ajustar_tensao", "tensaoSaida": 12.5 }
```

O servidor publica com QoS 1, sem `retain`. O firmware deve aplicar o valor de
forma idempotente, pois MQTT pode reenviar mensagens, validar os limites reais
do circuito e continuar publicando a tensão efetivamente medida. O ajuste não
envia automaticamente o comando `ligar`. Os comandos existentes
`{"comando":"ligar"}` e `{"comando":"desligar"}` continuam iguais.

## API e disponibilidade

- `GET /api/status`: inclui `tensaoMaxima` e `controleTensao` com `disponivel` e `motivo`.
- `POST /api/tensao-saida`: recebe `{"tensaoSaida":12.5}` e retorna
  `tensaoSolicitada` quando o broker confirma o envio.
- Valores negativos, não numéricos ou acima do máximo recebem HTTP 400.
- Sem broker, sem máximo válido ou sem leitura ao vivo nos últimos 15 segundos,
  o ajuste recebe HTTP 503. Alertas e mensagens retidas não renovam essa validade.
- O máximo é revalidado no servidor em cada envio, inclusive se diminuir durante
  a edição. Um ajuste simultâneo em andamento recebe HTTP 409.
- Se o broker não confirmar em 8 segundos, a API retorna HTTP 503 com aviso de
  envio sem confirmação. O comando pode ter sido entregue; confira a leitura
  antes de reenviar.
- A interface bloqueia o formulário se não receber uma atualização por 5 segundos.
- O máximo fica em memória; após reiniciar, o servidor aguarda nova telemetria.

## Temas

O botão da barra lateral alterna os modos claro e escuro, ambos azuis.
A escolha é salva localmente no navegador. Sem escolha anterior, o painel
acompanha o tema do sistema. Gráficos, campos, alertas e navegação também mudam.

## Validação local

Execute `npm test` para os testes de regressão. As verificações automatizadas
usam MQTT e banco simulados e não enviam comandos ao medidor físico. Para rodar
o site, instale as dependências com `npm ci`, configure o `.env` local e execute
`npm start`. Confira também `RENDER.md` para a configuração do banco hospedado.
