const consultaDeltaConsumo = ({
    inicio,
    fim,
    incluirAnterior,
    agrupamento,
    rotulo,
    campoRotulo,
}) => `
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

module.exports = { consultaDeltaConsumo };
