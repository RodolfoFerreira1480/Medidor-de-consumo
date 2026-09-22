const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'front-end')));

const LIMITE_PICO_PADRAO = Number(process.env.LIMITE_PICO_PADRAO) || 1000;

// PostgreSQL local, usando as variaveis DB_* do .env deste projeto.
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT) || 5432,
    ssl: false
});

// --- CONFIGURACAO DO MQTT USANDO .ENV ---
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
const TOPIC_DADOS = process.env.MQTT_TOPIC_DADOS || 'smart-meter/medidor/dados';
const TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO || 'smart-meter/medidor/comando';
const TOPIC_ALERTA = process.env.MQTT_TOPIC_ALERTA || 'smart-meter/medidor/alerta';

const mqttClient = mqtt.connect(MQTT_BROKER);

let ultimoEstado = {
    tensao: 0,
    tensaoSaida: null,
    corrente: 0,
    potencia: 0,
    consumoKWh: 0,
    limitePico: LIMITE_PICO_PADRAO,
    statusAlerta: false,
    alerta: null,
    timestampLeitura: null,
    timestamp: null,
};

let desarmePorPicoAtivo = false;

function numeroFinito(valor, padrao = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : padrao;
}

function normalizarLeitura(dadosRecebidos) {
    const tensao = numeroFinito(dadosRecebidos.tensao);
    // Ausencia de leitura nao equivale a uma saida medida em zero volts.
    const saidaRecebida = dadosRecebidos.tensaoSaida ?? dadosRecebidos.tensao_saida;
    const tensaoSaida = (typeof saidaRecebida === 'number'
        || (typeof saidaRecebida === 'string' && saidaRecebida.trim() !== ''))
        && Number.isFinite(Number(saidaRecebida)) && Number(saidaRecebida) >= 0
        ? Number(saidaRecebida) : null;
    const corrente = numeroFinito(dadosRecebidos.corrente);
    const potenciaInformada = dadosRecebidos.potencia == null ? NaN : Number(dadosRecebidos.potencia);
    const potencia = Number.isFinite(potenciaInformada) ? potenciaInformada : (tensaoSaida ?? tensao) * corrente;
    const consumoKWh = numeroFinito(
        dadosRecebidos.consumoKWh
        ?? dadosRecebidos.consumoKwh
        ?? dadosRecebidos.consumokwh
        ?? dadosRecebidos.consumo_kwh
    );

    return { tensao, tensaoSaida, corrente, potencia, consumoKWh };
}

async function inicializarBanco() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS historico (
            id SERIAL PRIMARY KEY,
            tensao DOUBLE PRECISION NOT NULL DEFAULT 0,
            tensao_saida DOUBLE PRECISION,
            corrente DOUBLE PRECISION NOT NULL DEFAULT 0,
            potencia DOUBLE PRECISION NOT NULL DEFAULT 0,
            consumokwh DOUBLE PRECISION NOT NULL DEFAULT 0,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE historico
        ADD COLUMN IF NOT EXISTS tensao DOUBLE PRECISION NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tensao_saida DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS corrente DOUBLE PRECISION NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS potencia DOUBLE PRECISION NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS consumokwh DOUBLE PRECISION NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS configuracoes (
            chave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_chave_idx
        ON configuracoes (chave)
    `);

    console.log('Banco de dados pronto para uso.');
}

async function buscarLimitePico() {
    const result = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'limite_pico'");
    const limiteSalvo = result.rows.length > 0 ? Number(result.rows[0].valor) : LIMITE_PICO_PADRAO;
    return Number.isFinite(limiteSalvo) && limiteSalvo > 0 ? limiteSalvo : LIMITE_PICO_PADRAO;
}

async function salvarLeituraBanco(leitura) {
    await pool.query(
        `INSERT INTO historico (tensao, corrente, potencia, consumokwh, tensao_saida) VALUES ($1, $2, $3, $4, $5)`,
        [leitura.tensao, leitura.corrente, leitura.potencia, leitura.consumoKWh, leitura.tensaoSaida]
    );
}

function publicarComando(comando) {
    return new Promise((resolve, reject) => {
        if (!mqttClient.connected) {
            reject(new Error('Broker MQTT desconectado'));
            return;
        }

        mqttClient.publish(TOPIC_COMANDO, JSON.stringify({ comando }), { qos: 1 }, (err) => {
            if (err) {
                reject(err);
                return;
            }

            resolve();
        });
    });
}

async function aplicarProtecaoPico(leitura, limitePicoAtual) {
    const emPico = leitura.potencia > limitePicoAtual;

    if (!emPico && desarmePorPicoAtivo && leitura.potencia <= limitePicoAtual * 0.95) {
        desarmePorPicoAtivo = false;
    }

    if (!emPico || desarmePorPicoAtivo) {
        return;
    }

    try {
        await publicarComando('desligar');
        desarmePorPicoAtivo = true;
        console.log(`Protecao acionada: potencia ${leitura.potencia}W acima do limite ${limitePicoAtual}W.`);
    } catch (err) {
        console.error('Falha ao enviar comando de desarme automatico:', err.message);
    }
}

const consultaDeltaConsumo = ({ inicio, fim, incluirAnterior, agrupamento, rotulo, campoRotulo }) => `
    WITH leituras_ordenadas AS (
        SELECT
            timestamp,
            consumokwh,
            LAG(consumokwh) OVER (ORDER BY timestamp) AS consumo_anterior
        FROM historico
        WHERE timestamp >= ${incluirAnterior}
          AND timestamp < ${fim}
    ),
    deltas AS (
        SELECT
            ${agrupamento} AS periodo,
            CASE
                WHEN consumo_anterior IS NULL THEN 0
                WHEN consumokwh >= consumo_anterior THEN consumokwh - consumo_anterior
                ELSE consumokwh
            END AS consumo_periodo
        FROM leituras_ordenadas
        WHERE timestamp >= ${inicio}
          AND timestamp < ${fim}
    )
    SELECT
        ${rotulo} AS ${campoRotulo},
        ROUND(COALESCE(SUM(consumo_periodo), 0)::numeric, 4)::double precision AS consumo_total
    FROM deltas
    GROUP BY periodo
    ORDER BY periodo ASC
`;

mqttClient.on('connect', () => {
    console.log('Conectado ao Broker MQTT com sucesso!');
    mqttClient.subscribe([TOPIC_DADOS, TOPIC_ALERTA], (err) => {
        if (err) {
            console.error('Erro ao se inscrever nos topicos MQTT:', err.message);
            return;
        }

        console.log(`Inscrito nos topicos: ${TOPIC_DADOS} e ${TOPIC_ALERTA}`);
    });
});

mqttClient.on('error', (err) => {
    console.error('Erro na conexao MQTT:', err.message);
});

// Recebendo mensagens do ESP32
mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();

    if (topic === TOPIC_DADOS) {
        let dadosRecebidos;

        try {
            dadosRecebidos = JSON.parse(payload);
        } catch (e) {
            console.log('Erro ao analisar JSON dos dados:', payload);
            return;
        }

        try {
            const leitura = normalizarLeitura(dadosRecebidos);
            const limitePicoAtual = await buscarLimitePico();
            const timestamp = new Date();

            ultimoEstado = {
                ...leitura,
                limitePico: limitePicoAtual,
                statusAlerta: leitura.potencia > limitePicoAtual,
                alerta: leitura.potencia > limitePicoAtual ? 'Pico de energia detectado' : null,
                timestampLeitura: timestamp,
                timestamp,
            };

            console.log('Dados recebidos do medidor:', ultimoEstado);

            try {
                await salvarLeituraBanco(leitura);
                console.log('Dados salvos no PostgreSQL com sucesso.');
            } catch (dbErr) {
                console.error('Erro ao salvar no banco:', dbErr.message);
            }

            await aplicarProtecaoPico(leitura, limitePicoAtual);
        } catch (e) {
            console.error('Erro ao processar dados do medidor:', e.message);
        }
    }

    if (topic === TOPIC_ALERTA) {
        ultimoEstado = {
            ...ultimoEstado,
            statusAlerta: true,
            alerta: payload,
            timestamp: new Date(),
        };

        console.log(`ALERTA DE PICO DE ENERGIA: ${payload}`);
    }
});

// --- ROTAS DA API HTTP ---

app.get('/api/status', (req, res) => {
    res.json(ultimoEstado);
});

// Rota para o site buscar o historico do PostgreSQL
app.get('/api/historico', async (req, res) => {
    try {
        const query = `SELECT *, tensao_saida AS "tensaoSaida" FROM historico ORDER BY timestamp DESC LIMIT 50`;
        const resultado = await pool.query(query);
        res.json(resultado.rows.reverse());
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para o Grafico Diario (consumo real por hora)
app.get('/api/consumo-diario', async (req, res) => {
    try {
        const query = consultaDeltaConsumo({
            inicio: 'CURRENT_DATE',
            fim: "CURRENT_DATE + INTERVAL '1 day'",
            incluirAnterior: "CURRENT_DATE - INTERVAL '1 day'",
            agrupamento: "date_trunc('hour', timestamp)",
            rotulo: "TO_CHAR(periodo, 'HH24:00')",
            campoRotulo: 'horario',
        });
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para o Consumo Semanal (ultimos 7 dias incluindo hoje)
app.get('/api/consumo-semanal', async (req, res) => {
    try {
        const query = consultaDeltaConsumo({
            inicio: "CURRENT_DATE - INTERVAL '6 days'",
            fim: "CURRENT_DATE + INTERVAL '1 day'",
            incluirAnterior: "CURRENT_DATE - INTERVAL '7 days'",
            agrupamento: "date_trunc('day', timestamp)",
            rotulo: "TO_CHAR(periodo, 'DD/MM')",
            campoRotulo: 'data',
        });
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para o Consumo Mensal (mes atual)
app.get('/api/consumo-mensal', async (req, res) => {
    try {
        const query = consultaDeltaConsumo({
            inicio: "date_trunc('month', CURRENT_DATE)",
            fim: "date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'",
            incluirAnterior: "date_trunc('month', CURRENT_DATE) - INTERVAL '1 day'",
            agrupamento: "date_trunc('day', timestamp)",
            rotulo: "TO_CHAR(periodo, 'DD/MM')",
            campoRotulo: 'data',
        });
        const resultado = await pool.query(query);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para o Historico de Picos de Energia
app.get('/api/picos', async (req, res) => {
    try {
        const limitePicoAtual = await buscarLimitePico();

        const query = `
            SELECT
                TO_CHAR(timestamp, 'HH24:MI:SS') AS horario,
                potencia
            FROM historico
            WHERE potencia > $1
              AND timestamp >= CURRENT_DATE
              AND timestamp < CURRENT_DATE + INTERVAL '1 day'
            ORDER BY timestamp DESC
        `;
        const resultado = await pool.query(query, [limitePicoAtual]);
        res.json({ limite: limitePicoAtual, picos: resultado.rows });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para o site consultar qual e o limite salvo no banco
app.get('/api/config/limite', async (req, res) => {
    try {
        const limite = await buscarLimitePico();
        res.json({ limite });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Rota para atualizar e salvar o novo limite permanentemente no banco
app.post('/api/config/limite', async (req, res) => {
    const novoLimiteNumero = Number(req.body.novoLimite);

    if (!Number.isFinite(novoLimiteNumero) || novoLimiteNumero <= 0) {
        return res.status(400).json({ erro: 'Informe um limite maior que zero' });
    }

    try {
        await pool.query(
            `INSERT INTO configuracoes (chave, valor) VALUES ('limite_pico', $1)
             ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
            [String(novoLimiteNumero)]
        );

        ultimoEstado.limitePico = novoLimiteNumero;

        console.log(`Novo limite de pico salvo no banco: ${novoLimiteNumero}W`);
        res.json({
            sucesso: true,
            limite: novoLimiteNumero,
            mensagem: 'Limite atualizado e salvo no banco com sucesso!',
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/comando', async (req, res) => {
    const { acao } = req.body;
    const comandosPermitidos = new Set(['ligar', 'desligar']);

    if (!comandosPermitidos.has(acao)) {
        return res.status(400).json({ erro: 'Comando invalido' });
    }

    try {
        await publicarComando(acao);
        console.log(`Comando enviado para o ESP32: ${acao}`);
        res.json({ sucesso: true, mensagem: `Comando '${acao}' enviado com sucesso.` });
    } catch (err) {
        res.status(503).json({ erro: `Falha ao enviar comando para o medidor: ${err.message}` });
    }
});

const PORT = process.env.PORT || 3000;

inicializarBanco()
    .catch((err) => {
        console.error('Erro ao preparar o banco de dados:', err.message);
    })
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
        });
    });