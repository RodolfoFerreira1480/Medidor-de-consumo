# Estimativa de custo

Em **Configurações → Tarifa de energia**, selecione o estado e, se quiser,
a cidade. Escolha a distribuidora que aparece na sua conta e salve a tarifa.
A cidade filtra as distribuidoras; não existe uma tarifa única por estado
ou município.

O modo **Informar valor da conta** permite cadastrar um preço próprio em
R$/kWh. A alteração só entra no cálculo depois de salva no servidor.

Os resumos de hoje, semana e mês usam o consumo registrado em cada período
multiplicado pela tarifa salva. Não é usado o contador acumulado do ESP32
como se fosse o consumo do mês. A tarifa escolhida é aplicada a todo o
período; o cálculo não reconstrói reajustes antigos e não representa a
fatura completa. Períodos sem leituras e tarifas indisponíveis aparecem
como “—”.

As referências ANEEL correspondem à tarifa residencial B1 convencional,
TE + TUSD, convertida de R$/MWh para R$/kWh. Não incluem impostos,
bandeiras, iluminação pública ou cobranças fixas. Confira a fonte e a
vigência mostradas na tela. Tarifa vencida não é usada automaticamente.

A configuração é persistida em `configuracoes`, na chave `tarifa_energia`,
usando a tabela já existente. Não há chave de API ou dependência adicional.

O catálogo em `data/tarifas.json` é uma cópia das fontes públicas, não uma
consulta em tempo real. Para renovar preços e localidades, execute
`npm run tarifas:atualizar` com Node.js 18 ou superior e acesso à internet.
O processo valida os dados antes de substituir o catálogo anterior.
Depois, reinicie o servidor ou publique a nova versão para carregar a base.

A relação entre cidades e distribuidoras usa as unidades consumidoras
ativas no último mês informado por cada agente ao INDGER. Essa referência
pode ser antiga para algumas distribuidoras; confirme a escolha na conta.
Os dados derivados da ANEEL mantêm atribuição e indicação da licença
[ODbL](https://opendatacommons.org/licenses/odbl/) no catálogo.

Fontes: [tarifas da ANEEL](https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica),
[INDGER da ANEEL](https://dadosabertos.aneel.gov.br/dataset/indger-indicadores-gerenciais-da-distribuicao)
e [localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/localidades).
