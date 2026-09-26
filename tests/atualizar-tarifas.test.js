const assert = require('node:assert/strict');
const test = require('node:test');
const { criarCatalogo, numeroANEEL, dataNoBrasil } = require('../scripts/atualizar-tarifas.cjs');

function cnpj(indice) {
    return String(indice + 1).padStart(14, '0');
}

function tarifa(alteracoes = {}) {
    return {
        NumCNPJDistribuidora: cnpj(0),
        SigAgente: 'Distribuidora de teste 0',
        DscBaseTarifaria: 'Tarifa de Aplicação',
        DscSubGrupo: 'B1',
        DscModalidadeTarifaria: 'Convencional',
        DscClasse: 'Residencial',
        DscSubClasse: 'Residencial',
        DscDetalhe: 'Não se aplica',
        NomPostoTarifario: 'Não se aplica',
        DscUnidadeTerciaria: 'MWh',
        DatInicioVigencia: '2026-01-01',
        DatFimVigencia: '2026-12-31',
        DatGeracaoConjuntoDados: '2026-09-24',
        VlrTUSD: '400,00',
        VlrTE: '300,00',
        DscREH: 'Resolução sintética 1',
        ...alteracoes,
    };
}

function dadosComCobertura() {
    const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const municipios = Array.from({ length: 5500 }, (_, indice) => ({
        id: 1000000 + indice,
        nome: `Município sintético ${indice}`,
        microrregiao: { mesorregiao: { UF: { sigla: ufs[indice % ufs.length] } } },
    }));
    return {
        atualizadoEm: '2026-09-25',
        estados: ufs.map(sigla => ({ sigla, nome: `Estado sintético ${sigla}` })),
        municipios,
        tarifas: Array.from({ length: 90 }, (_, indice) => tarifa({ NumCNPJDistribuidora: cnpj(indice), SigAgente: `Distribuidora de teste ${indice}` })),
        comerciais: municipios.map((municipio, indice) => ({
            NumCNPJ: cnpj(indice % 90),
            SigAgente: `Distribuidora de teste ${indice % 90}`,
            NomAgente: `Empresa sintética ${indice % 90}`,
            CodMunicipioIBGE: String(municipio.id),
            QtdUCAtiva: '10',
            DatReferenciaInformada: '2026-07-01',
            DatGeracaoConjuntoDados: '2026-09-23',
        })),
    };
}

function dadosSomenteTarifas(tarifas) {
    return { tarifas, comerciais: [], estados: [], municipios: [], atualizadoEm: '2026-09-25' };
}

test('números ANEEL aceitam decimais brasileiros e pontos apenas como milhares', () => {
    for (const [entrada, esperado] of [
        ['0', 0], ['0,00', 0], ['432,17', 432.17], ['1234,56', 1234.56],
        ['1.234', 1234], ['1.234,56', 1234.56], ['1.234.567,89', 1234567.89],
        [0, 0], [432.17, 432.17],
    ]) assert.equal(numeroANEEL(entrada), esperado, `Entrada: ${entrada}`);
});

test('números ambíguos, malformados ou coercíveis não viram preços silenciosamente', () => {
    for (const entrada of [
        '', ' ', ' 432,17', '432,17 ', '432.17', '1,234.56', '12.34,56', '1.23.456,78',
        '1,,2', '1,', '1e3', '0x10', 'R$ 1,00', 'NaN', 'Infinity', true, false,
        null, undefined, [], [123], {},
    ]) assert.throws(() => numeroANEEL(entrada), /Formato numérico inesperado/, `Entrada: ${String(entrada)}`);
});

test('tarifas negativas e valores não finitos são rejeitados', () => {
    for (const entrada of [-0.01, -1, NaN, Infinity, -Infinity]) {
        assert.throws(() => numeroANEEL(entrada), /Valor tarifário inválido/);
    }
    assert.throws(() => numeroANEEL('-1,00'));
    assert.throws(() => numeroANEEL('9'.repeat(400)), /Valor tarifário inválido/);
});

test('conversão MWh para kWh preserva TE e TUSD e soma os componentes', () => {
    const dados = dadosComCobertura();
    dados.tarifas[0] = tarifa({ VlrTUSD: '1.234,56', VlrTE: '250,00' });
    const catalogo = criarCatalogo(dados);
    const convertida = catalogo.distribuidoras.find(item => item.id === cnpj(0)).tarifas[0];
    assert.equal(convertida.tusdKWh, 1.23456);
    assert.equal(convertida.teKWh, 0.25);
    assert.equal(convertida.valorKWh, 1.48456);
    assert.equal(convertida.inicioVigencia, '2026-01-01');
    assert.equal(convertida.fimVigencia, '2026-12-31');
    assert.equal(catalogo.municipios.length, 5500);
    assert.equal(catalogo.distribuidoras.length, 90);
});

test('linhas tarifárias repetidas equivalentes geram uma única tarifa', () => {
    const dados = dadosComCobertura();
    dados.tarifas.push(tarifa(), tarifa({ VlrTUSD: 400, VlrTE: 300 }));
    const distribuidora = criarCatalogo(dados).distribuidoras.find(item => item.id === cnpj(0));
    assert.equal(distribuidora.tarifas.length, 1);
    assert.equal(distribuidora.tarifas[0].valorKWh, 0.7);
});

test('preços diferentes na mesma distribuidora e vigência interrompem a atualização', () => {
    for (const alteracoes of [{ VlrTE: '310,00' }, { VlrTUSD: '410,00' }]) {
        const original = tarifa();
        const divergente = tarifa({ ...alteracoes, DscREH: 'Resolução sintética 2' });
        for (const linhas of [[original, divergente], [divergente, original]]) {
            assert.throws(() => criarCatalogo(dadosSomenteTarifas(linhas)), erro => {
                assert.match(erro.message, /Tarifas conflitantes/);
                assert.ok(erro.message.includes(cnpj(0)));
                assert.ok(erro.message.includes('2026-01-01'));
                return true;
            });
        }
    }
});

test('componentes divergentes geram conflito mesmo quando o total é igual', () => {
    const linhas = [tarifa(), tarifa({ VlrTUSD: '450,00', VlrTE: '250,00' })];
    assert.throws(() => criarCatalogo(dadosSomenteTarifas(linhas)), /Tarifas conflitantes/);
});

test('mudança de preço em outra vigência permanece como tarifa separada', () => {
    const dados = dadosComCobertura();
    dados.tarifas.push(tarifa({ DatInicioVigencia: '2027-01-01', DatFimVigencia: '2027-12-31', VlrTUSD: '500,00' }));
    const tarifas = criarCatalogo(dados).distribuidoras.find(item => item.id === cnpj(0)).tarifas;
    assert.deepEqual(tarifas.map(item => [item.inicioVigencia, item.valorKWh]), [['2027-01-01', 0.8], ['2026-01-01', 0.7]]);
});

test('linhas de outras classes e modalidades não contaminam a tarifa residencial convencional', () => {
    const dados = dadosComCobertura();
    for (const filtro of [
        { DscBaseTarifaria: 'Tarifa de Referência' }, { DscSubGrupo: 'B2' },
        { DscModalidadeTarifaria: 'Branca' }, { DscClasse: 'Comercial' },
        { DscSubClasse: 'Residencial Baixa Renda' }, { DscDetalhe: 'Desconto' },
        { NomPostoTarifario: 'Ponta' }, { DscUnidadeTerciaria: 'kW' },
    ]) dados.tarifas.push(tarifa({ ...filtro, VlrTE: 'preço de outro produto' }));
    const tarifas = criarCatalogo(dados).distribuidoras.find(item => item.id === cnpj(0)).tarifas;
    assert.equal(tarifas.length, 1);
    assert.equal(tarifas[0].valorKWh, 0.7);
});

test('cadastro municipal usa a última referência disponível de cada distribuidora e ignora a futura', () => {
    const dados = dadosComCobertura();
    dados.comerciais.push(
        { ...dados.comerciais[0], DatReferenciaInformada: '2026-08-01' },
        { ...dados.comerciais[90], DatReferenciaInformada: '2026-10-01' },
    );
    const catalogo = criarCatalogo(dados);
    assert.deepEqual(catalogo.municipios.find(item => item.codigo === '1000000').distribuidoras, [cnpj(0)]);
    assert.deepEqual(catalogo.municipios.find(item => item.codigo === '1000090').distribuidoras, []);
    assert.equal(catalogo.distribuidoras.find(item => item.id === cnpj(0)).referenciaMunicipios, '2026-08-01');
});

test('quantidades ativas inválidas interrompem a importação sem inventar cobertura municipal', () => {
    const dados = dadosComCobertura();
    for (const quantidade of ['abc', '', ' ', null, undefined, -1, '-1', NaN, Infinity, true, false, [], [10]]) {
        dados.comerciais[0].QtdUCAtiva = quantidade;
        assert.throws(() => criarCatalogo(dados), /Quantidade de unidades consumidoras inválida/, `Quantidade: ${String(quantidade)}`);
    }
});

test('zero unidades ativas é válido, mas não oferece a distribuidora naquela cidade', () => {
    const dados = dadosComCobertura();
    dados.comerciais[0].QtdUCAtiva = '0';
    dados.comerciais[1].QtdUCAtiva = 0;
    const catalogo = criarCatalogo(dados);
    assert.deepEqual(catalogo.municipios.find(item => item.codigo === '1000000').distribuidoras, []);
    assert.deepEqual(catalogo.municipios.find(item => item.codigo === '1000001').distribuidoras, []);
    assert.deepEqual(catalogo.municipios.find(item => item.codigo === '1000002').distribuidoras, [cnpj(2)]);
});

test('identificadores inválidos e cobertura incompleta impedem gerar um catálogo substituto', () => {
    assert.throws(() => criarCatalogo(dadosSomenteTarifas([tarifa({ NumCNPJDistribuidora: '123' })])), /CNPJ inválido/);
    assert.throws(() => criarCatalogo(dadosSomenteTarifas([tarifa()])), /Cobertura insuficiente/);
});

test('data de atualização segue São Paulo mesmo quando UTC já virou o dia', () => {
    assert.equal(dataNoBrasil(new Date('2026-09-25T02:59:59Z')), '2026-09-24');
    assert.equal(dataNoBrasil(new Date('2026-09-25T03:00:00Z')), '2026-09-25');
});
