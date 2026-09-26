const FONTE = {
    nome: 'ANEEL — tarifas residenciais',
    url: 'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica',
};

function dataNoBrasil(data) {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(data).map(parte => [parte.type, parte.value]));
    return `${partes.year}-${partes.month}-${partes.day}`;
}

function entradaInvalida(mensagem) {
    const erro = new Error(mensagem);
    erro.status = 400;
    return erro;
}

function criarServicoTarifas(catalogo, agora = () => new Date()) {
    const estados = new Map(catalogo.estados.map(estado => [estado.sigla, estado]));
    const municipios = new Map(catalogo.municipios.map(municipio => [municipio.codigo, municipio]));
    const distribuidoras = new Map(catalogo.distribuidoras.map(distribuidora => [distribuidora.id, distribuidora]));

    function localidade(uf, codigoMunicipio) {
        if (typeof uf !== 'string' || !estados.has(uf)) throw entradaInvalida('Selecione um estado válido.');
        const municipio = codigoMunicipio == null || codigoMunicipio === '' ? null : municipios.get(codigoMunicipio);
        if (codigoMunicipio != null && codigoMunicipio !== '' && (!municipio || municipio.uf !== uf)) {
            throw entradaInvalida('A cidade selecionada não pertence ao estado informado.');
        }
        return { uf, municipio };
    }

    function atende(distribuidora, regiao) {
        return regiao.municipio ? regiao.municipio.distribuidoras.includes(distribuidora.id)
            : distribuidora.ufs.includes(regiao.uf);
    }

    function vigente(distribuidora) {
        const hoje = dataNoBrasil(agora());
        return distribuidora.tarifas.filter(tarifa => tarifa.inicioVigencia <= hoje
            && tarifa.fimVigencia >= hoje && Number.isFinite(tarifa.valorKWh) && tarifa.valorKWh > 0)
            .sort((a, b) => b.inicioVigencia.localeCompare(a.inicioVigencia))[0] || null;
    }

    function listarDistribuidoras(uf, codigoMunicipio) {
        const regiao = localidade(uf, codigoMunicipio);
        const opcoes = catalogo.distribuidoras.filter(distribuidora => atende(distribuidora, regiao))
            .map(distribuidora => {
                const tarifa = vigente(distribuidora);
                return tarifa ? { id: distribuidora.id, nome: distribuidora.nome, tarifaKWh: tarifa.valorKWh,
                    inicioVigencia: tarifa.inicioVigencia, fimVigencia: tarifa.fimVigencia } : null;
            }).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return { distribuidoras: opcoes, atualizadoEm: catalogo.atualizadoEm,
            aviso: opcoes.length ? 'Confira na sua conta qual distribuidora atende sua unidade.'
                : 'Nenhuma tarifa residencial convencional vigente disponível para esta localidade. Você pode informar o valor da sua conta.' };
    }

    function normalizarConfiguracao(dados) {
        if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw entradaInvalida('Informe a configuração da tarifa.');
        if (dados.modo === 'manual') {
            const valor = dados.valorKWh;
            if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > 100
                || Math.abs(valor * 1e6 - Math.round(valor * 1e6)) > 1e-7) {
                throw entradaInvalida('Informe um valor por kWh maior que zero e até R$ 100, com no máximo seis casas decimais.');
            }
            return { modo: 'manual', valorKWh: valor, uf: null, municipio: null, distribuidoraId: null };
        }
        if (dados.modo !== 'localidade') throw entradaInvalida('Selecione como deseja definir a tarifa.');
        const regiao = localidade(dados.uf, dados.municipio);
        const distribuidora = distribuidoras.get(dados.distribuidoraId);
        if (!distribuidora || !atende(distribuidora, regiao)) {
            throw entradaInvalida('Selecione uma distribuidora da localidade informada.');
        }
        if (!vigente(distribuidora)) throw entradaInvalida('Não há tarifa vigente para esta distribuidora no catálogo. Informe o valor da sua conta.');
        return { modo: 'localidade', uf: regiao.uf, municipio: regiao.municipio?.codigo || null,
            distribuidoraId: distribuidora.id, valorKWh: null };
    }

    function resolverConfiguracao(configuracao) {
        if (!configuracao) return { configuracao: null, tarifa: null, aviso: 'Selecione uma tarifa para estimar os custos.' };
        try {
            const validada = normalizarConfiguracao(configuracao);
            if (validada.modo === 'manual') return { configuracao: validada,
                tarifa: { valorKWh: validada.valorKWh, origem: 'manual', distribuidora: null, inicioVigencia: null, fimVigencia: null },
                aviso: 'Estimativa calculada com o valor por kWh informado por você.' };
            const distribuidora = distribuidoras.get(validada.distribuidoraId);
            const tarifa = vigente(distribuidora);
            return { configuracao: validada, tarifa: { ...tarifa, origem: 'aneel', distribuidora: distribuidora.nome },
                aviso: 'Tarifa residencial convencional sem impostos, bandeiras tarifárias ou iluminação pública.' };
        } catch (erro) {
            if (erro.status !== 400) throw erro;
            return { configuracao: null, tarifa: null, aviso: `A tarifa salva precisa ser selecionada novamente. ${erro.message}` };
        }
    }

    return {
        listarEstados: () => ({ estados: catalogo.estados, atualizadoEm: catalogo.atualizadoEm, fonte: FONTE }),
        listarMunicipios(uf) {
            localidade(uf, null);
            return { municipios: catalogo.municipios.filter(municipio => municipio.uf === uf)
                .map(({ codigo, nome }) => ({ codigo, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) };
        },
        listarDistribuidoras, normalizarConfiguracao, resolverConfiguracao,
    };
}

function registrarRotasTarifas(app, pool, opcoes = {}) {
    const catalogo = opcoes.catalogo || require('../data/tarifas.json');
    const servico = criarServicoTarifas(catalogo, opcoes.agora);
    const responderLista = consultar => (req, res) => {
        try { res.json(consultar(req)); }
        catch (erro) { res.status(erro.status || 500).json({ erro: erro.message }); }
    };
    app.get('/api/tarifas/estados', responderLista(() => servico.listarEstados()));
    app.get('/api/tarifas/municipios', responderLista(req => servico.listarMunicipios(req.query?.uf)));
    app.get('/api/tarifas/distribuidoras', responderLista(req => servico.listarDistribuidoras(req.query?.uf, req.query?.municipio)));
    app.get('/api/config/tarifa', async (req, res) => {
        res.set?.('Cache-Control', 'no-store');
        try {
            const resultado = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'tarifa_energia'");
            let configuracao = null;
            if (resultado.rows.length) {
                try { configuracao = JSON.parse(resultado.rows[0].valor); }
                catch { return res.json({ configuracao: null, tarifa: null, aviso: 'A configuração salva é inválida. Selecione uma tarifa novamente.' }); }
            }
            res.json(servico.resolverConfiguracao(configuracao));
        } catch {
            res.status(503).json({ erro: 'Não foi possível carregar a tarifa salva. Tente novamente.' });
        }
    });
    app.post('/api/config/tarifa', async (req, res) => {
        let configuracao;
        try { configuracao = servico.normalizarConfiguracao(req.body); }
        catch (erro) { return res.status(erro.status || 500).json({ erro: erro.message }); }
        try {
            await pool.query(`INSERT INTO configuracoes (chave, valor) VALUES ('tarifa_energia', $1)
                ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(configuracao)]);
            res.json(servico.resolverConfiguracao(configuracao));
        } catch {
            res.status(503).json({ erro: 'Não foi possível salvar a tarifa. A configuração anterior foi mantida.' });
        }
    });
    return servico;
}

module.exports = { criarServicoTarifas, registrarRotasTarifas };
