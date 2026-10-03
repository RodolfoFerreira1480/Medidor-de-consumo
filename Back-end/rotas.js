const { tensaoValida } = require('./medicoes');
const { consultaDeltaConsumo } = require('./consumo');

function registrarRotas(
    app,
    { pool, estado, buscarLimitePico, estadoControleTensao, publicarComando },
) {
    app.get('/api/status', (req, res) => {
        res.set?.('Cache-Control', 'no-store');
        res.json({ ...estado.ultimoEstado, controleTensao: estadoControleTensao() });
    });

    app.post('/api/tensao-saida', async (req, res) => {
        const tensaoSaida = tensaoValida(req.body?.tensaoSaida);
        if (tensaoSaida === null) {
            return res
                .status(400)
                .json({ erro: 'Informe uma tensão de saída válida, maior ou igual a zero.' });
        }
        const controle = estadoControleTensao();
        if (!controle.disponivel) return res.status(503).json({ erro: controle.motivo });
        if (tensaoSaida > estado.ultimoEstado.tensaoMaxima) {
            return res.status(400).json({
                erro: `A tensão não pode ultrapassar ${estado.ultimoEstado.tensaoMaxima} V, limite informado pelo ESP32.`,
            });
        }
        if (estado.ajusteEmAndamento)
            return res.status(409).json({ erro: 'Já existe um ajuste sendo enviado. Aguarde.' });
        estado.ajusteEmAndamento = true;
        try {
            await publicarComando('ajustar_tensao', { tensaoSaida });
            res.json({
                sucesso: true,
                tensaoSolicitada: tensaoSaida,
                mensagem: 'Comando enviado. Acompanhe a tensão medida para verificar a saída.',
            });
        } catch (err) {
            res.status(503).json({ erro: `Falha ao enviar ajuste: ${err.message}` });
        } finally {
            estado.ajusteEmAndamento = false;
        }
    });

    app.get('/api/historico', async (req, res) => {
        try {
            const query = `SELECT *, tensao_saida AS "tensaoSaida" FROM historico ORDER BY timestamp DESC LIMIT 50`;
            const resultado = await pool.query(query);
            res.json(resultado.rows.reverse());
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    });

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

    app.get('/api/config/limite', async (req, res) => {
        try {
            const limite = await buscarLimitePico();
            res.json({ limite });
        } catch (err) {
            res.status(500).json({ erro: err.message });
        }
    });

    app.post('/api/config/limite', async (req, res) => {
        const novoLimiteNumero = Number(req.body.novoLimite);

        if (!Number.isFinite(novoLimiteNumero) || novoLimiteNumero <= 0) {
            return res.status(400).json({ erro: 'Informe um limite maior que zero' });
        }

        try {
            await pool.query(
                `INSERT INTO configuracoes (chave, valor) VALUES ('limite_pico', $1)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [String(novoLimiteNumero)],
            );

            estado.ultimoEstado.limitePico = novoLimiteNumero;

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
            res.status(503).json({
                erro: `Falha ao enviar comando para o medidor: ${err.message}`,
            });
        }
    });
}

module.exports = { registrarRotas };
