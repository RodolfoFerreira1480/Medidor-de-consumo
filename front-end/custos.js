(() => {
    'use strict';

    const form = document.getElementById('form-tarifa');
    const campos = document.getElementById('tarifa-campos');
    const modo = document.getElementById('tarifa-modo');
    const uf = document.getElementById('tarifa-uf');
    const municipio = document.getElementById('tarifa-municipio');
    const distribuidora = document.getElementById('tarifa-distribuidora');
    const valor = document.getElementById('tarifa-valor');
    const botao = document.getElementById('salvar-tarifa');
    const feedback = document.getElementById('feedback-tarifa');
    const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
    const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const preco = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    let salvo = null;
    let configuracaoDisponivel = false;
    let consumos = { dia: null, semana: null, mes: null };
    let distribuidoras = [];
    let pronto = false;
    let editado = false;
    let salvando = false;
    let carregandoLocalidade = false;
    let versaoLocalidade = 0;
    let versaoConfiguracao = 0;
    let consultaConfiguracao = false;

    function mensagem(texto, erro = false) {
        feedback.textContent = texto;
        feedback.className = `feedback${erro ? ' error' : ''}`;
    }

    async function consultar(caminho, opcoes) {
        const controle = new AbortController();
        const timeout = setTimeout(() => controle.abort(), 12000);
        try {
            const resposta = await fetch(`${base}${caminho}`, { ...opcoes, signal: controle.signal });
            const dados = await resposta.json();
            if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível consultar a tarifa.');
            return dados;
        } catch (erro) {
            if (erro.name === 'AbortError') throw new Error('A consulta demorou demais. Tente novamente.');
            if (erro instanceof TypeError) throw new Error('Sem conexão com o servidor. Tente novamente.');
            throw erro;
        } finally {
            clearTimeout(timeout);
        }
    }

    function preencherSelect(elemento, rotulo, itens, chave, nome, selecionado = '') {
        elemento.replaceChildren(new Option(rotulo, ''));
        for (const item of itens) elemento.add(new Option(item[nome], String(item[chave])));
        elemento.value = selecionado || '';
    }

    function dataLegivel(data) {
        if (!data || !/^\d{4}-\d{2}-\d{2}/.test(data)) return 'não informada';
        return data.slice(0, 10).split('-').reverse().join('/');
    }

    function vigencia(tarifa) {
        return `Vigência: ${dataLegivel(tarifa.inicioVigencia)} a ${dataLegivel(tarifa.fimVigencia)}.`;
    }

    function tarifaEfetiva() {
        const tarifa = salvo?.tarifa;
        if (!configuracaoDisponivel || typeof tarifa?.valorKWh !== 'number' || !Number.isFinite(tarifa.valorKWh) || tarifa.valorKWh <= 0) return null;
        if (tarifa.origem === 'aneel') {
            const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
            if (!tarifa.inicioVigencia || !tarifa.fimVigencia || hoje < tarifa.inicioVigencia.slice(0, 10) || hoje > tarifa.fimVigencia.slice(0, 10)) return null;
        }
        return tarifa;
    }

    function atualizarCustos() {
        const tarifa = tarifaEfetiva();
        for (const periodo of ['dia', 'semana', 'mes']) {
            const consumo = consumos[periodo];
            document.getElementById(`custo-${periodo}`).textContent = tarifa && consumo !== null
                ? moeda.format(consumo * tarifa.valorKWh) : '—';
        }
        let resumo = 'Configure a tarifa de energia para estimar os custos.';
        if (!configuracaoDisponivel) resumo = 'Estimativa indisponível enquanto a tarifa salva não puder ser confirmada.';
        else if (salvo?.configuracao && !tarifa) resumo = salvo.aviso || 'A tarifa salva não está vigente ou disponível. Atualize a configuração.';
        else if (tarifa) {
            resumo = `Estimativa do consumo medido × R$ ${preco.format(tarifa.valorKWh)}/kWh. A tarifa salva é aplicada a todo o período, sem reconstruir reajustes anteriores.`;
            resumo += tarifa.origem === 'aneel' ? ' Não inclui impostos, bandeiras ou iluminação pública.' : ' Usa o preço informado da conta; cobranças fixas não são incluídas.';
            if (Object.values(consumos).some((total) => total === null)) resumo += ' Períodos sem leituras disponíveis aparecem com —.';
        }
        document.getElementById('resumo-custos').textContent = resumo;
    }

    window.atualizarConsumoCustos = (totais) => {
        for (const periodo of ['dia', 'semana', 'mes']) {
            const total = totais?.[periodo];
            consumos[periodo] = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null;
        }
        atualizarCustos();
    };

    function mostrarSalvo() {
        const tarifa = tarifaEfetiva();
        const resumo = document.getElementById('tarifa-salva');
        const detalhes = document.getElementById('tarifa-salva-detalhes');
        if (!configuracaoDisponivel) {
            resumo.textContent = 'Tarifa indisponível';
            detalhes.textContent = 'Não foi possível confirmar a configuração no servidor. Os custos serão atualizados quando a conexão voltar.';
        } else if (tarifa) {
            resumo.textContent = `R$ ${preco.format(tarifa.valorKWh)}/kWh`;
            detalhes.textContent = tarifa.origem === 'aneel'
                ? `${tarifa.distribuidora} · ANEEL · Residencial convencional. ${vigencia(tarifa)}`
                : 'Valor da conta informado manualmente e salvo no servidor.';
        } else {
            resumo.textContent = salvo?.configuracao ? 'Tarifa não disponível para cálculo' : 'Nenhuma tarifa configurada';
            detalhes.textContent = salvo?.aviso || 'Os custos aparecerão após salvar uma tarifa.';
        }
        atualizarCustos();
    }

    function atualizarFormulario() {
        const local = modo.value === 'localidade';
        document.getElementById('tarifa-localidade').hidden = !local;
        document.getElementById('tarifa-manual').hidden = local;
        campos.disabled = !pronto || salvando;
        uf.disabled = !local;
        uf.required = local;
        municipio.disabled = !local || !uf.value || carregandoLocalidade;
        distribuidora.disabled = !local || !uf.value || carregandoLocalidade || !distribuidoras.length;
        distribuidora.required = local;
        valor.disabled = local;
        valor.required = !local;
        botao.disabled = salvando || !pronto || (local && (carregandoLocalidade || !uf.value || !distribuidora.value));
        botao.textContent = salvando ? 'Salvando…' : 'Salvar tarifa';
    }

    function mostrarPrevia() {
        const tarifa = distribuidoras.find((item) => item.id === distribuidora.value);
        document.getElementById('tarifa-previa').textContent = tarifa ? `R$ ${preco.format(tarifa.tarifaKWh)}/kWh` : '—';
        document.getElementById('tarifa-vigencia-previa').textContent = tarifa
            ? `${vigencia(tarifa)} Salve para usar este valor no cálculo.` : 'Selecione uma distribuidora.';
    }

    async function carregarDistribuidoras(versao, selecao = '') {
        const parametros = new URLSearchParams({ uf: uf.value });
        if (municipio.value) parametros.set('municipio', municipio.value);
        const dados = await consultar(`/api/tarifas/distribuidoras?${parametros}`);
        if (versao !== versaoLocalidade) return;
        distribuidoras = dados.distribuidoras;
        preencherSelect(distribuidora, distribuidoras.length ? 'Selecione a distribuidora' : 'Nenhuma tarifa vigente disponível', distribuidoras, 'id', 'nome', selecao);
        document.getElementById('tarifa-catalogo-aviso').textContent = dados.aviso || '';
        mostrarPrevia();
    }

    async function carregarLocalidade(cidadeSalva = '', distribuidoraSalva = '', incluirCidades = true) {
        const versao = ++versaoLocalidade;
        distribuidoras = [];
        preencherSelect(distribuidora, uf.value ? 'Carregando distribuidoras…' : 'Selecione o estado primeiro', [], 'id', 'nome');
        if (incluirCidades) preencherSelect(municipio, 'Todo o estado', [], 'codigo', 'nome');
        document.getElementById('tarifa-catalogo-aviso').textContent = '';
        mostrarPrevia();
        carregandoLocalidade = !!uf.value;
        atualizarFormulario();
        if (!uf.value) return;
        try {
            if (incluirCidades) {
                try {
                    const dados = await consultar(`/api/tarifas/municipios?uf=${encodeURIComponent(uf.value)}`);
                    if (versao !== versaoLocalidade) return;
                    preencherSelect(municipio, 'Todo o estado', dados.municipios, 'codigo', 'nome', cidadeSalva);
                } catch (erro) {
                    if (versao !== versaoLocalidade) return;
                    mensagem(`Não foi possível carregar as cidades. Você ainda pode selecionar a distribuidora pelo estado. ${erro.message}`, true);
                }
            }
            await carregarDistribuidoras(versao, distribuidoraSalva);
        } catch (erro) {
            if (versao !== versaoLocalidade) return;
            preencherSelect(distribuidora, 'Consulta indisponível — selecione o estado novamente', [], 'id', 'nome');
            mensagem(erro.message, true);
        } finally {
            if (versao === versaoLocalidade) {
                carregandoLocalidade = false;
                atualizarFormulario();
            }
        }
    }

    const estadosProntos = (async () => {
        try {
            const dados = await consultar('/api/tarifas/estados');
            preencherSelect(uf, 'Selecione o estado', dados.estados, 'sigla', 'nome');
            const fonte = document.getElementById('tarifa-fonte');
            fonte.textContent = `Fonte: ${dados.fonte?.nome || 'ANEEL'}. Base atualizada em ${dataLegivel(dados.atualizadoEm)}. `;
            if (dados.fonte?.url?.startsWith('https://dadosabertos.aneel.gov.br/')) {
                const link = document.createElement('a');
                link.href = dados.fonte.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Consultar fonte';
                fonte.append(link);
            }
        } catch (erro) {
            document.getElementById('tarifa-catalogo-aviso').textContent = 'Catálogo indisponível. Você pode informar o preço da sua conta no modo manual.';
        }
    })();

    async function restaurarFormulario(configuracao) {
        await estadosProntos;
        if (editado || salvando) return;
        modo.value = configuracao?.modo || 'localidade';
        valor.value = configuracao?.modo === 'manual' ? String(configuracao.valorKWh).replace('.', ',') : '';
        uf.value = configuracao?.uf || '';
        atualizarFormulario();
        if (modo.value === 'localidade') await carregarLocalidade(configuracao?.municipio, configuracao?.distribuidoraId);
    }

    async function carregarConfiguracao(inicial = false) {
        if (consultaConfiguracao || salvando) return;
        const versao = ++versaoConfiguracao;
        consultaConfiguracao = true;
        try {
            const dados = await consultar('/api/config/tarifa');
            if (versao !== versaoConfiguracao) return;
            salvo = dados;
            configuracaoDisponivel = true;
            mostrarSalvo();
            if (inicial) {
                mensagem(dados.aviso || 'Escolha uma tarifa e salve para calcular os custos.');
                await restaurarFormulario(dados.configuracao);
            }
        } catch (erro) {
            if (versao !== versaoConfiguracao) return;
            configuracaoDisponivel = false;
            mostrarSalvo();
            if (inicial) mensagem(erro.message, true);
        } finally {
            consultaConfiguracao = false;
            if (inicial) pronto = true;
            atualizarFormulario();
        }
    }

    function marcarEdicao() {
        editado = true;
        mensagem('Alterações ainda não salvas. Os custos continuam usando a tarifa salva.');
    }

    modo.addEventListener('change', () => {
        marcarEdicao();
        atualizarFormulario();
    });
    uf.addEventListener('change', () => {
        marcarEdicao();
        carregarLocalidade();
    });
    municipio.addEventListener('change', () => {
        marcarEdicao();
        carregarLocalidade('', '', false);
    });
    distribuidora.addEventListener('change', () => {
        marcarEdicao();
        mostrarPrevia();
        atualizarFormulario();
    });
    valor.addEventListener('input', marcarEdicao);

    form.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        if (salvando || !pronto) return;
        let configuracao;
        if (modo.value === 'manual') {
            const texto = valor.value.trim();
            const numero = Number(texto.replace(',', '.'));
            if (!/^\d+(?:[.,]\d{1,6})?$/.test(texto) || !Number.isFinite(numero) || numero <= 0 || numero > 100) {
                mensagem('Informe um preço maior que zero e até R$ 100/kWh, com no máximo 6 casas decimais.', true);
                valor.focus();
                return;
            }
            configuracao = { modo: 'manual', valorKWh: numero };
        } else {
            if (carregandoLocalidade || !uf.value || !distribuidora.value || !distribuidoras.some((item) => item.id === distribuidora.value)) {
                mensagem('Selecione o estado e a distribuidora da sua conta.', true);
                return;
            }
            configuracao = { modo: 'localidade', uf: uf.value, municipio: municipio.value || null, distribuidoraId: distribuidora.value };
        }
        salvando = true;
        ++versaoConfiguracao;
        atualizarFormulario();
        mensagem('Salvando tarifa…');
        try {
            const dados = await consultar('/api/config/tarifa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configuracao),
            });
            salvo = dados;
            configuracaoDisponivel = true;
            editado = false;
            mostrarSalvo();
            mensagem(dados.aviso || 'Tarifa salva. A estimativa usa este valor para todo o período.');
        } catch (erro) {
            mensagem(`Não foi possível confirmar o salvamento. ${erro.message}`, true);
        } finally {
            salvando = false;
            atualizarFormulario();
        }
    });

    carregarConfiguracao(true);
    setInterval(() => {
        mostrarSalvo();
        carregarConfiguracao();
    }, 60000);
})();
