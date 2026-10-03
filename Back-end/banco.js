function configurarBanco(env) {
    const connectionString = env.DATABASE_URL?.trim();
    const host = env.DB_HOST?.trim();
    if (env.RENDER && !connectionString && !host) {
        throw new Error(
            'Configure DATABASE_URL ou DB_HOST no Environment do Render com a conexao PostgreSQL do Supabase.',
        );
    }
    const config = connectionString
        ? { connectionString }
        : {
              user: env.DB_USER,
              password: env.DB_PASSWORD,
              host,
              database: env.DB_DATABASE,
              port: Number(env.DB_PORT) || 5432,
          };
    const usarSSL =
        env.DB_SSL === 'true' ||
        (env.DB_SSL !== 'false' &&
            (Boolean(env.RENDER) ||
                /supabase\.(com|co)([/:?]|$)/i.test(connectionString || host || '')));
    config.ssl = usarSSL
        ? {
              rejectUnauthorized: true,
              ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
          }
        : false;
    config.connectionTimeoutMillis = 10000;
    return config;
}

function criarRepositorio(pool, LIMITE_PICO_PADRAO) {
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
        const result = await pool.query(
            "SELECT valor FROM configuracoes WHERE chave = 'limite_pico'",
        );
        const limiteSalvo =
            result.rows.length > 0 ? Number(result.rows[0].valor) : LIMITE_PICO_PADRAO;
        return Number.isFinite(limiteSalvo) && limiteSalvo > 0 ? limiteSalvo : LIMITE_PICO_PADRAO;
    }

    async function salvarLeituraBanco(leitura) {
        await pool.query(
            `INSERT INTO historico (tensao, corrente, potencia, consumokwh, tensao_saida) VALUES ($1, $2, $3, $4, $5)`,
            [
                leitura.tensao,
                leitura.corrente,
                leitura.potencia,
                leitura.consumoKWh,
                leitura.tensaoSaida,
            ],
        );
    }

    return { inicializarBanco, buscarLimitePico, salvarLeituraBanco };
}

module.exports = { configurarBanco, criarRepositorio };
