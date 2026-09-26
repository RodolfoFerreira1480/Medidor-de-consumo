const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname, '../front-end/custos.js'), 'utf8');
const configuracaoManual = (valorKWh) => ({
    configuracao: { modo: 'manual', valorKWh },
    tarifa: { valorKWh, origem: 'manual' },
    aviso: null,
});
const tarifaLocal = (id) => ({ id, nome: `Distribuidora ${id}`, tarifaKWh: 0.8, inicioVigencia: '2020-01-01', fimVigencia: '2099-12-31' });
const resposta = (dados, ok = true) => ({ ok, json: async () => dados });
const concluirRequisicoes = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

function painel(configuracao = { configuracao: null, tarifa: null, aviso: null }, opcoesPainel = {}) {
    const elementos = new Map();
    const periodicos = [];
    const requisicoes = [];
    const servidor = { salvo: configuracao, interceptar: opcoesPainel.interceptar || null };
    function elemento(id) {
        if (!elementos.has(id)) elementos.set(id, {
            value: id === 'tarifa-modo' ? 'localidade' : '', textContent: '', listeners: {}, options: [], hidden: false,
            addEventListener(evento, fn) { this.listeners[evento] = fn; },
            replaceChildren(...opcoes) { this.options = opcoes; },
            add(opcao) { this.options.push(opcao); },
            append() {},
            focus() { this.focused = true; },
        });
        return elementos.get(id);
    }
    const window = { location: { protocol: opcoesPainel.protocolo || 'http:' } };
    const contexto = vm.createContext({
        window, Intl, Date, AbortController, URLSearchParams,
        Option: function (text, value) { this.text = text; this.value = value; },
        document: { getElementById: elemento, createElement: () => ({}) },
        setTimeout: () => 1, clearTimeout() {}, setInterval: (fn) => periodicos.push(fn),
        fetch: async (url, opcoes) => {
            requisicoes.push({ url, opcoes });
            const interceptada = servidor.interceptar?.(url, opcoes);
            if (interceptada !== undefined) return interceptada;
            if (url === '/api/tarifas/estados') return resposta({
                estados: [{ sigla: 'SP', nome: 'São Paulo' }, { sigla: 'RJ', nome: 'Rio de Janeiro' }],
                fonte: { nome: 'ANEEL', url: 'https://dadosabertos.aneel.gov.br/dataset/tarifas' }, atualizadoEm: '2026-09-25',
            });
            if (url === '/api/config/tarifa') {
                if (opcoes?.method === 'POST') {
                    const config = JSON.parse(opcoes.body);
                    servidor.salvo = config.modo === 'manual' ? configuracaoManual(config.valorKWh) : {
                        configuracao: config,
                        tarifa: { ...tarifaLocal(config.distribuidoraId), valorKWh: 0.8, origem: 'aneel', distribuidora: config.distribuidoraId },
                    };
                }
                return resposta(servidor.salvo);
            }
            if (url.startsWith('/api/tarifas/municipios?')) return resposta({ municipios: [{ codigo: '3550308', nome: 'São Paulo' }] });
            if (url.startsWith('/api/tarifas/distribuidoras?')) return resposta({ distribuidoras: [tarifaLocal(new URLSearchParams(url.split('?')[1]).get('uf'))] });
            throw new Error(`Rota inesperada: ${url}`);
        },
    });
    vm.runInContext(codigo, contexto);
    return {
        elemento, window, servidor, requisicoes,
        async alterar(id, value, evento = 'change') {
            elemento(id).value = value;
            elemento(id).listeners[evento]();
            await concluirRequisicoes();
        },
        async atualizar() { periodicos[0](); await concluirRequisicoes(); },
        salvar: () => elemento('form-tarifa').listeners.submit({ preventDefault() {} }),
        custo: (periodo) => elemento(`custo-${periodo}`).textContent.replace(/\s/g, ''),
        posts: () => requisicoes.filter((req) => req.opcoes?.method === 'POST'),
    };
}

test('custo só usa tarifa confirmada no servidor e restaura ao recarregar sem depender dos gráficos', async () => {
    const p = painel();
    await concluirRequisicoes();
    p.window.atualizarConsumoCustos({ dia: 6.8, semana: 47.6, mes: 136 });
    assert.equal(p.custo('dia'), '—');
    await p.alterar('tarifa-modo', 'manual');
    await p.alterar('tarifa-valor', '0,9', 'input');
    assert.equal(p.custo('dia'), '—');
    await p.salvar();
    assert.equal(p.custo('dia'), 'R$6,12');
    assert.equal(p.custo('semana'), 'R$42,84');
    assert.equal(p.custo('mes'), 'R$122,40');
    const recarregado = painel(p.servidor.salvo);
    await concluirRequisicoes();
    assert.equal(recarregado.elemento('tarifa-modo').value, 'manual');
    assert.equal(recarregado.elemento('tarifa-valor').value, '0,9');
    recarregado.window.atualizarConsumoCustos({ dia: 6.8 });
    assert.equal(recarregado.custo('dia'), 'R$6,12');
    assert.equal(recarregado.custo('mes'), '—');
});

test('revalidação preserva o rascunho e indisponibilidade de dados ou tarifa remove os custos', async () => {
    const p = painel(configuracaoManual(0.9));
    await concluirRequisicoes();
    p.window.atualizarConsumoCustos({ dia: 6.8, semana: 0, mes: null });
    await p.alterar('tarifa-valor', '1,2', 'input');
    await p.atualizar();
    assert.equal(p.elemento('tarifa-valor').value, '1,2');
    assert.equal(p.custo('dia'), 'R$6,12');
    assert.equal(p.custo('semana'), 'R$0,00');
    assert.equal(p.custo('mes'), '—');
    p.servidor.interceptar = (url) => url === '/api/config/tarifa' ? resposta({ erro: 'Servidor indisponível' }, false) : undefined;
    await p.atualizar();
    assert.equal(p.custo('dia'), '—');
    p.servidor.interceptar = null;
    await p.atualizar();
    assert.equal(p.custo('dia'), 'R$6,12');
    assert.equal(p.elemento('tarifa-valor').value, '1,2');
    p.window.atualizarConsumoCustos(null);
    assert.equal(p.custo('dia'), '—');
});

test('preço inválido nunca é enviado e erro de salvamento mantém a tarifa anterior', async () => {
    const p = painel(configuracaoManual(0.9));
    await concluirRequisicoes();
    p.window.atualizarConsumoCustos({ dia: 6.8 });
    for (const preco of ['', '0', '-1', '101', '0,1234567', '1e2', 'Infinity', '1,2.3']) {
        await p.alterar('tarifa-valor', preco, 'input');
        await p.salvar();
    }
    assert.equal(p.posts().length, 0);
    p.servidor.interceptar = (url, opcoes) => opcoes?.method === 'POST' ? resposta({ erro: 'Não foi possível gravar' }, false) : undefined;
    await p.alterar('tarifa-valor', '1,2', 'input');
    await p.salvar();
    assert.equal(p.custo('dia'), 'R$6,12');
    assert.match(p.elemento('feedback-tarifa').textContent, /Não foi possível gravar/);
    assert.equal(p.elemento('tarifa-campos').disabled, false);
});

test('resposta antiga de localidade não troca a distribuidora e envio automático não aceita preço do navegador', async () => {
    const p = painel();
    await concluirRequisicoes();
    let concluirSP;
    p.servidor.interceptar = (url) => url.startsWith('/api/tarifas/distribuidoras?uf=SP')
        ? new Promise((resolve) => { concluirSP = () => resolve(resposta({ distribuidoras: [tarifaLocal('SP')] })); }) : undefined;
    await p.alterar('tarifa-uf', 'SP');
    await p.alterar('tarifa-uf', 'RJ');
    concluirSP();
    await concluirRequisicoes();
    assert.equal(p.elemento('tarifa-distribuidora').options[1].value, 'RJ');
    await p.alterar('tarifa-distribuidora', 'RJ');
    await p.salvar();
    assert.deepEqual(JSON.parse(p.posts()[0].opcoes.body), { modo: 'localidade', uf: 'RJ', municipio: null, distribuidoraId: 'RJ' });
    p.window.atualizarConsumoCustos({ dia: 10 });
    assert.equal(p.custo('dia'), 'R$8,00');
});

test('resposta periódica iniciada antes de salvar não substitui a tarifa recém-confirmada', async () => {
    const p = painel(configuracaoManual(0.9));
    await concluirRequisicoes();
    let concluirAntiga;
    p.servidor.interceptar = (url, opcoes) => url === '/api/config/tarifa' && opcoes?.method !== 'POST'
        ? new Promise((resolve) => { concluirAntiga = () => resolve(resposta(configuracaoManual(0.9))); }) : undefined;
    await p.atualizar();
    await p.alterar('tarifa-valor', '1,2', 'input');
    await p.salvar();
    concluirAntiga();
    await concluirRequisicoes();
    p.window.atualizarConsumoCustos({ dia: 10 });
    assert.equal(p.custo('dia'), 'R$12,00');
});

test('tarifa oficial expirada não é usada mesmo se o servidor devolver um valor', async () => {
    const p = painel({
        configuracao: { modo: 'localidade', uf: 'SP', municipio: null, distribuidoraId: 'SP' },
        tarifa: { valorKWh: 0.8, origem: 'aneel', distribuidora: 'SP', inicioVigencia: '2000-01-01', fimVigencia: '2000-12-31' },
    });
    await concluirRequisicoes();
    p.window.atualizarConsumoCustos({ dia: 10 });
    assert.equal(p.custo('dia'), '—');
    assert.match(p.elemento('resumo-custos').textContent, /não está vigente/);
});

test('estados e configuração recuperam após falha inicial sem recarregar a página', async () => {
    const p = painel({
        configuracao: { modo: 'localidade', uf: 'SP', municipio: '3550308', distribuidoraId: 'SP' },
        tarifa: { valorKWh: 0.8, origem: 'aneel', distribuidora: 'SP', inicioVigencia: '2020-01-01', fimVigencia: '2099-12-31' },
    }, { interceptar: () => resposta({ erro: 'Servidor iniciando' }, false) });
    await concluirRequisicoes();
    assert.equal(p.elemento('recarregar-tarifa').hidden, false);
    assert.match(p.elemento('tarifa-catalogo-aviso').textContent, /Catálogo indisponível/);
    p.servidor.interceptar = null;
    await p.atualizar();
    assert.equal(p.elemento('tarifa-uf').options.length, 3);
    assert.equal(p.elemento('tarifa-uf').value, 'SP');
    assert.equal(p.elemento('tarifa-municipio').value, '3550308');
    assert.equal(p.elemento('tarifa-distribuidora').value, 'SP');
    assert.equal(p.elemento('recarregar-tarifa').hidden, true);
    p.window.atualizarConsumoCustos({ dia: 10 });
    assert.equal(p.custo('dia'), 'R$8,00');
    const chamadasEstados = p.requisicoes.filter((req) => req.url === '/api/tarifas/estados').length;
    await p.atualizar();
    assert.equal(p.requisicoes.filter((req) => req.url === '/api/tarifas/estados').length, chamadasEstados);
});

test('botão e atualização automática compartilham a mesma tentativa de recuperar estados', async () => {
    const p = painel(undefined, {
        interceptar: (url) => url === '/api/tarifas/estados' ? resposta({ erro: 'Catálogo indisponível' }, false) : undefined,
    });
    await concluirRequisicoes();
    assert.match(p.elemento('tarifa-catalogo-aviso').textContent, /Catálogo indisponível/);
    let concluirEstados;
    p.servidor.interceptar = (url) => url === '/api/tarifas/estados'
        ? new Promise((resolve) => { concluirEstados = () => resolve(resposta({ estados: [{ sigla: 'SP', nome: 'São Paulo' }] })); }) : undefined;
    p.elemento('recarregar-tarifa').listeners.click();
    await p.atualizar();
    p.elemento('recarregar-tarifa').listeners.click();
    assert.equal(p.requisicoes.filter((req) => req.url === '/api/tarifas/estados').length, 2);
    assert.equal(p.elemento('recarregar-tarifa').disabled, true);
    concluirEstados();
    await concluirRequisicoes();
    assert.equal(p.elemento('tarifa-uf').options.length, 2);
    assert.equal(p.elemento('tarifa-catalogo-aviso').textContent, '');
    assert.equal(p.elemento('recarregar-tarifa').hidden, true);
});

test('arquivo aberto sem servidor orienta iniciar localhost e recuperação preserva rascunho', async () => {
    const p = painel(configuracaoManual(0.9), {
        protocolo: 'file:', interceptar: () => { throw new TypeError('Failed to fetch'); },
    });
    await concluirRequisicoes();
    assert.match(p.elemento('feedback-tarifa').textContent, /Inicie o servidor local e abra http:\/\/localhost:3000/);
    await p.alterar('tarifa-modo', 'manual');
    await p.alterar('tarifa-valor', '1,234', 'input');
    p.servidor.interceptar = (url) => {
        if (url.endsWith('/api/tarifas/estados')) return resposta({ estados: [{ sigla: 'SP', nome: 'São Paulo' }] });
        if (url.endsWith('/api/config/tarifa')) return resposta(configuracaoManual(0.9));
    };
    p.elemento('recarregar-tarifa').listeners.click();
    await concluirRequisicoes();
    assert.equal(p.elemento('tarifa-modo').value, 'manual');
    assert.equal(p.elemento('tarifa-valor').value, '1,234');
    assert.equal(p.posts().length, 0);
    p.window.atualizarConsumoCustos({ dia: 10 });
    assert.equal(p.custo('dia'), 'R$9,00');
});

test('resposta HTML de servidor antigo mostra orientação em vez de erro JSON', async () => {
    const p = painel(undefined, {
        protocolo: 'file:',
        interceptar: () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    });
    await concluirRequisicoes();
    assert.match(p.elemento('feedback-tarifa').textContent, /versão atualizada do servidor.*http:\/\/localhost:3000/);
    assert.doesNotMatch(p.elemento('feedback-tarifa').textContent, /Unexpected token/);
    assert.equal(p.elemento('recarregar-tarifa').hidden, false);
});
