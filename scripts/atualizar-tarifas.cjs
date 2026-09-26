const fs = require('node:fs/promises');
const path = require('node:path');

const API = 'https://dadosabertos.aneel.gov.br/api/3/action/';
const RECURSOS = {
  tarifas: 'fcf2906c-7c32-4b9b-a637-054e7a5234f4',
  municipios: 'fd10c9d4-cb76-4020-a322-e79afb13eaf7'
};
const FONTES = [
  { nome: 'ANEEL — Tarifas de aplicação', url: 'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica' },
  { nome: 'ANEEL — INDGER, dados comerciais', url: 'https://dadosabertos.aneel.gov.br/dataset/indger-indicadores-gerenciais-da-distribuicao' },
  { nome: 'IBGE — Localidades', url: 'https://servicodados.ibge.gov.br/api/docs/localidades' }
];

async function obterJson(url) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!resposta.ok) throw new Error(`Fonte oficial respondeu HTTP ${resposta.status}: ${url}`);
  return resposta.json();
}

async function obterRegistros(resourceId, parametros = {}) {
  const registros = [];
  let total = Infinity;
  while (registros.length < total) {
    const query = new URLSearchParams({ resource_id: resourceId, limit: '32000', offset: String(registros.length), sort: '_id asc', ...parametros });
    const resposta = await obterJson(`${API}datastore_search?${query}`);
    if (!resposta.success || !Array.isArray(resposta.result?.records)) throw new Error('Resposta inválida da ANEEL.');
    const pagina = resposta.result.records;
    total = resposta.result.total;
    if (!Number.isSafeInteger(total) || !pagina.length && registros.length < total) throw new Error('Base da ANEEL incompleta.');
    registros.push(...pagina);
  }
  return registros;
}

function numeroANEEL(valor) {
  if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor || !/^(?:\d{1,3}(?:\.\d{3})*|\d+)?(?:,\d+)?$/.test(valor))) throw new Error('Formato numérico inesperado na ANEEL.');
  const numero = typeof valor === 'number' ? valor : Number(valor.replaceAll('.', '').replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0) throw new Error('Valor tarifário inválido na ANEEL.');
  return numero;
}

function dataNoBrasil(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(data).map(parte => [parte.type, parte.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function criarCatalogo({ tarifas, comerciais, estados, municipios, atualizadoEm = dataNoBrasil() }) {
  const dataCorte = `${Number(atualizadoEm.slice(0, 4)) - 2}${atualizadoEm.slice(4)}`;
  const ultimasReferencias = new Map();
  for (const registro of comerciais) {
    if (registro.DatReferenciaInformada <= atualizadoEm && (!ultimasReferencias.has(registro.NumCNPJ) || registro.DatReferenciaInformada > ultimasReferencias.get(registro.NumCNPJ))) {
      ultimasReferencias.set(registro.NumCNPJ, registro.DatReferenciaInformada);
    }
  }
  const porDistribuidora = new Map();
  const residenciais = tarifas.filter(r => r.DscBaseTarifaria === 'Tarifa de Aplicação' && r.DscSubGrupo === 'B1' && r.DscModalidadeTarifaria === 'Convencional' && r.DscClasse === 'Residencial' && r.DscSubClasse === 'Residencial' && r.DscDetalhe === 'Não se aplica' && r.NomPostoTarifario === 'Não se aplica' && r.DscUnidadeTerciaria === 'MWh');
  for (const registro of residenciais) {
    if (registro.DatFimVigencia < dataCorte) continue;
    const id = registro.NumCNPJDistribuidora;
    if (!/^\d{14}$/.test(id)) throw new Error('CNPJ inválido na base tarifária.');
    if (!porDistribuidora.has(id)) porDistribuidora.set(id, { id, nome: registro.SigAgente, sigla: registro.SigAgente, ufs: new Set(), tarifas: [] });
    const distribuidora = porDistribuidora.get(id);
    const tusdKWh = Number((numeroANEEL(registro.VlrTUSD) / 1000).toFixed(5));
    const teKWh = Number((numeroANEEL(registro.VlrTE) / 1000).toFixed(5));
    const tarifa = { valorKWh: Number((tusdKWh + teKWh).toFixed(5)), inicioVigencia: registro.DatInicioVigencia, fimVigencia: registro.DatFimVigencia, tusdKWh, teKWh, resolucao: registro.DscREH };
    const conflito = distribuidora.tarifas.find(t => t.inicioVigencia === tarifa.inicioVigencia && t.fimVigencia === tarifa.fimVigencia && (t.teKWh !== tarifa.teKWh || t.tusdKWh !== tarifa.tusdKWh));
    if (conflito) throw new Error(`Tarifas conflitantes para ${id} em ${tarifa.inicioVigencia}; verifique as resoluções antes de substituir o catálogo.`);
    if (!distribuidora.tarifas.some(t => t.inicioVigencia === tarifa.inicioVigencia && t.fimVigencia === tarifa.fimVigencia && t.valorKWh === tarifa.valorKWh)) distribuidora.tarifas.push(tarifa);
  }
  const municipiosPorCodigo = new Map(municipios.map(municipio => {
    const uf = municipio.microrregiao?.mesorregiao?.UF?.sigla || municipio['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;
    if (!uf) throw new Error(`UF ausente no IBGE: ${municipio.id}`);
    return [String(municipio.id), { codigo: String(municipio.id), nome: municipio.nome, uf, distribuidoras: new Set() }];
  }));
  const codigosNaoReconhecidos = new Set();
  for (const registro of comerciais) {
    const distribuidora = porDistribuidora.get(registro.NumCNPJ);
    if (!distribuidora || registro.DatReferenciaInformada !== ultimasReferencias.get(registro.NumCNPJ)) continue;
    const unidades = registro.QtdUCAtiva;
    if ((typeof unidades !== 'number' && (typeof unidades !== 'string' || !unidades.trim())) || !Number.isFinite(Number(unidades)) || Number(unidades) < 0) throw new Error('Quantidade de unidades consumidoras inválida no INDGER.');
    if (Number(unidades) === 0) continue;
    const municipio = municipiosPorCodigo.get(registro.CodMunicipioIBGE);
    if (!municipio) { codigosNaoReconhecidos.add(registro.CodMunicipioIBGE); continue; }
    municipio.distribuidoras.add(distribuidora.id);
    distribuidora.ufs.add(municipio.uf);
    distribuidora.nome = registro.SigAgente && registro.SigAgente !== 'Não Informado' ? registro.SigAgente : registro.NomAgente;
    distribuidora.razaoSocial = registro.NomAgente;
    distribuidora.referenciaMunicipios = registro.DatReferenciaInformada;
  }
  const distribuidoras = [...porDistribuidora.values()].filter(d => d.ufs.size > 0).map(d => ({ ...d, ufs: [...d.ufs].sort(), tarifas: d.tarifas.sort((a, b) => b.inicioVigencia.localeCompare(a.inicioVigencia) || b.fimVigencia.localeCompare(a.fimVigencia)) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const cidades = [...municipiosPorCodigo.values()].map(m => ({ ...m, distribuidoras: [...m.distribuidoras].sort() }));
  const listaEstados = estados.map(e => ({ sigla: e.sigla, nome: e.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (listaEstados.length !== 27 || cidades.length < 5500 || cidades.filter(m => m.distribuidoras.length > 0).length < 5000 || distribuidoras.length < 90) throw new Error('Cobertura insuficiente; catálogo anterior preservado.');
  return {
    atualizadoEm,
    fontes: FONTES,
    licencaANEEL: 'https://opendatacommons.org/licenses/odbl/',
    modalidade: 'Residencial B1 convencional — TE + TUSD, sem tributos, bandeiras ou iluminação pública',
    referenciaTarifas: tarifas.reduce((data, r) => r.DatGeracaoConjuntoDados > data ? r.DatGeracaoConjuntoDados : data, ''),
    referenciaMunicipios: comerciais.reduce((data, r) => r.DatGeracaoConjuntoDados > data ? r.DatGeracaoConjuntoDados : data, ''),
    observacaoMunicipios: 'Distribuidoras com unidades consumidoras ativas no último mês informado por cada agente ao INDGER. Confirme a distribuidora na sua conta; pode haver mais de uma opção por município.',
    codigosMunicipiosIgnorados: [...codigosNaoReconhecidos].sort(),
    estados: listaEstados,
    municipios: cidades,
    distribuidoras
  };
}

async function main() {
  const [tarifas, comerciais, estados, municipios] = await Promise.all([
    obterRegistros(RECURSOS.tarifas, { filters: JSON.stringify({ DscBaseTarifaria: 'Tarifa de Aplicação', DscSubGrupo: 'B1', DscModalidadeTarifaria: 'Convencional', DscClasse: 'Residencial', DscSubClasse: 'Residencial', DscDetalhe: 'Não se aplica' }) }),
    obterRegistros(RECURSOS.municipios, { fields: 'DatGeracaoConjuntoDados,NumCNPJ,SigAgente,NomAgente,DatReferenciaInformada,CodMunicipioIBGE,QtdUCAtiva' }),
    obterJson('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome'),
    obterJson('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome')
  ]);
  const catalogo = criarCatalogo({ tarifas, comerciais, estados, municipios });
  const destino = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'tarifas.json'));
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.tmp`;
  await fs.writeFile(temporario, `${JSON.stringify(catalogo)}\n`, 'utf8');
  await fs.rename(temporario, destino);
  console.log(`Catálogo atualizado: ${catalogo.estados.length} UFs, ${catalogo.municipios.length} municípios, ${catalogo.distribuidoras.length} distribuidoras.`);
}

module.exports = { criarCatalogo, numeroANEEL, dataNoBrasil };
if (require.main === module) main().catch(erro => { console.error(erro.message); process.exitCode = 1; });
