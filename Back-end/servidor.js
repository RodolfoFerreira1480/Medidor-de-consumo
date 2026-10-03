const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const { lerConfiguracao } = require('./configuracao');
const { configurarBanco, criarRepositorio } = require('./banco');
const { criarEstado } = require('./estado');
const { criarControle } = require('./controle');
const { registrarEventosMqtt } = require('./mqtt');
const { registrarRotas } = require('./rotas');
const { registrarRotasTarifas } = require('./tarifas');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'front-end')));

const {
    LIMITE_PICO_PADRAO,
    VALIDADE_LEITURA_MS,
    MQTT_BROKER,
    TOPIC_DADOS,
    TOPIC_COMANDO,
    TOPIC_ALERTA,
    PORT,
} = lerConfiguracao(process.env);
const pool = new Pool(configurarBanco(process.env));
registrarRotasTarifas(app, pool);

const mqttClient = mqtt.connect(MQTT_BROKER);
const estado = criarEstado(LIMITE_PICO_PADRAO);
const { inicializarBanco, buscarLimitePico, salvarLeituraBanco } = criarRepositorio(
    pool,
    LIMITE_PICO_PADRAO,
);
const { estadoControleTensao, publicarComando, aplicarProtecaoPico } = criarControle({
    mqttClient,
    estado,
    TOPIC_COMANDO,
    VALIDADE_LEITURA_MS,
});

registrarEventosMqtt({
    mqttClient,
    estado,
    TOPIC_DADOS,
    TOPIC_ALERTA,
    salvarLeituraBanco,
    aplicarProtecaoPico,
});
registrarRotas(app, { pool, estado, buscarLimitePico, estadoControleTensao, publicarComando });

inicializarBanco()
    .then(async () => {
        estado.ultimoEstado.limitePico = await buscarLimitePico();
    })
    .catch((err) => {
        console.error('Erro ao preparar o banco de dados:', err);
    })
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
        });
    });
