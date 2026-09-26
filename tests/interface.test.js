const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function interfaceTeste(arquivo, { temaSalvo = null, escuro = false, falhaStorage = false } = {}) {
    const elements = new Map();
    const timers = new Map();
    const eventos = {};
    const storage = new Map(temaSalvo ? [['energia-tema', temaSalvo]] : []);
    let nextTimer = 0;
    function elemento(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', innerHTML: '', disabled: true, listeners: {}, attributes: {},
            addEventListener(evento, cb) { this.listeners[evento] = cb; },
            setAttribute(chave, valor) { this.attributes[chave] = valor; },
            setCustomValidity(mensagem) { this.validationMessage = mensagem; },
            reportValidity() { return this.value !== '' && !this.validationMessage; },
        });
        return elements.get(id);
    }
    const document = { documentElement: { dataset: {} }, getElementById: elemento,
        addEventListener(evento, cb) { eventos[evento] = cb; } };
    const sistema = { matches: escuro, addEventListener(evento, cb) { this.change = cb; } };
    const requests = [];
    const window = { location: { protocol: 'http:' }, matchMedia: () => sistema, dispatchEvent() {} };
    const c = vm.createContext({ window, document, Event, AbortController,
        localStorage: {
            getItem(key) { if (falhaStorage) throw new Error(); return storage.get(key); },
            setItem(key, value) { if (falhaStorage) throw new Error(); storage.set(key, value); },
        },
        setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => ({ tensaoSolicitada: JSON.parse(options.body).tensaoSaida }) };
        },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../front-end', arquivo), 'utf8'), c);
    return { c, window, document, elemento, requests, timers, eventos, storage, sistema };
}

test('formulário sincroniza slider, preserva edição, rejeita redução do máximo e separa solicitação de medição', async () => {
    const b = interfaceTeste('controle-tensao.js');
    const status = { tensaoMaxima: 24, controleTensao: { disponivel: true } };
    b.window.atualizarControleTensao(status);
    assert.equal(b.elemento('input-tensao').disabled, false);
    b.elemento('range-tensao').value = '12.5';
    b.elemento('range-tensao').listeners.input();
    assert.equal(b.elemento('input-tensao').value, '12.5');
    b.window.atualizarControleTensao(status);
    assert.equal(b.elemento('input-tensao').value, '12.5');
    const submeter = () => b.elemento('form-tensao').listeners.submit({ preventDefault() {} });
    await submeter();
    assert.equal(b.requests[0].url, '/api/tensao-saida');
    assert.deepEqual(JSON.parse(b.requests[0].options.body), { tensaoSaida: 12.5 });
    assert.equal(b.elemento('tensao-solicitada').textContent, '12,5 V');
    assert.equal(b.elemento('val-tensao-saida').innerHTML, '');
    b.window.atualizarControleTensao({ ...status, tensaoMaxima: 10 });
    await submeter();
    assert.equal(b.requests.length, 1);
    assert.match(b.elemento('input-tensao').validationMessage, /10 V/);
    b.elemento('input-tensao').value = '0';
    await submeter();
    assert.equal(JSON.parse(b.requests[1].options.body).tensaoSaida, 0);
    b.elemento('input-tensao').value = '';
    await submeter();
    assert.equal(b.requests.length, 2);
});

test('formulário bloqueia ao perder dados e ao expirar uma requisição de atualização', () => {
    const b = interfaceTeste('controle-tensao.js');
    b.window.atualizarControleTensao({ tensaoMaxima: 24, controleTensao: { disponivel: true } });
    [...b.timers.values()].find(t => t.ms === 5000).fn();
    assert.equal(b.elemento('aplicar-tensao').disabled, true);
    b.window.atualizarControleTensao({ tensaoMaxima: 24, controleTensao: { disponivel: true } });
    assert.equal(b.elemento('aplicar-tensao').disabled, false);
    b.elemento('input-tensao').value = '12';
    b.window.atualizarControleTensao({ controleTensao: { motivo: 'Sem conexão' } });
    assert.equal(b.elemento('aplicar-tensao').disabled, true);
    assert.match(b.elemento('val-tensao-maxima').innerHTML, /^— /);
    assert.equal(b.elemento('estado-tensao').textContent, 'Sem conexão');
});

test('erro da API não é exibido como sucesso nem substitui a última solicitação', async () => {
    const b = interfaceTeste('controle-tensao.js');
    b.c.fetch = async () => ({ ok: false, json: async () => ({ erro: 'Limite alterado pelo ESP32' }) });
    b.window.atualizarControleTensao({ tensaoMaxima: 24, controleTensao: { disponivel: true } });
    b.elemento('input-tensao').value = '12';
    await b.elemento('form-tensao').listeners.submit({ preventDefault() {} });
    assert.equal(b.elemento('feedback-tensao').className, 'feedback error');
    assert.equal(b.elemento('feedback-tensao').textContent, 'Limite alterado pelo ESP32');
    assert.equal(b.elemento('tensao-solicitada').textContent, '');
    assert.equal(b.elemento('aplicar-tensao').disabled, false);
});

test('tema segue o sistema até a escolha manual e restaura a preferência', () => {
    const b = interfaceTeste('theme.js', { escuro: true });
    assert.equal(b.document.documentElement.dataset.theme, 'dark');
    b.sistema.change({ matches: false });
    assert.equal(b.document.documentElement.dataset.theme, 'light');
    b.window.alternarTema();
    assert.equal(b.storage.get('energia-tema'), 'dark');
    b.sistema.change({ matches: false });
    assert.equal(b.document.documentElement.dataset.theme, 'dark');
    b.eventos.DOMContentLoaded();
    assert.equal(b.elemento('theme-toggle').attributes['aria-pressed'], 'true');
    const recarregado = interfaceTeste('theme.js', { temaSalvo: 'dark' });
    assert.equal(recarregado.document.documentElement.dataset.theme, 'dark');
});

test('tema funciona com armazenamento bloqueado e ignora preferência inválida', () => {
    const b = interfaceTeste('theme.js', { falhaStorage: true });
    b.window.alternarTema();
    assert.equal(b.document.documentElement.dataset.theme, 'dark');
    const invalido = interfaceTeste('theme.js', { temaSalvo: 'invalido', escuro: true });
    assert.equal(invalido.document.documentElement.dataset.theme, 'dark');
});
