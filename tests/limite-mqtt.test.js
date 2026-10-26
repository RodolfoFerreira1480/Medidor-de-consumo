const {test} = require('node:test');
const assert = require('node:assert/strict');
const {criarPublicadorLimite} = require('../Back-end/limite-mqtt');
const {registrarRotas} = require('../Back-end/rotas');
test('publica configuração retida com QoS 1 e unidade em watts', async()=>{
 const chamadas=[];
 const mqttClient={connected:true,publish:(...args)=>{chamadas.push(args.slice(0,3));args[3]();}};
 const estado={ultimoEstado:{limitePico:1500}};
 const {publicarLimite}=criarPublicadorLimite({mqttClient,estado,topico:'teste/config/limite'});
 await publicarLimite();
 assert.deepEqual(chamadas[0],['teste/config/limite',JSON.stringify({limitePotencia:1500,unidade:'W'}),{qos:1,retain:true}]);
 estado.ultimoEstado.limitePico=1800;
 await publicarLimite();
 assert.equal(JSON.parse(chamadas[1][1]).limitePotencia,1800);
});
test('broker desconectado e falha de publicação rejeitam o envio',async()=>{
 const mqttClient={connected:false,publish:(_t,_p,_o,cb)=>cb(new Error('falhou'))};
 const {publicarLimite}=criarPublicadorLimite({mqttClient,estado:{ultimoEstado:{limitePico:100}},topico:'teste'});
 await assert.rejects(publicarLimite(),/desconectado/);
 mqttClient.connected=true;
 await assert.rejects(publicarLimite(),/falhou/);
});
function rota(publicarLimite, query=async()=>{}) {
 const rotas={}; const estado={ultimoEstado:{limitePico:1000}};
 registrarRotas({get(){},post(p,f){rotas[p]=f;}},{pool:{query},estado,publicarLimite});
 return {executar:rotas['/api/config/limite'],estado};
}
function resposta(){return {code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('salva e publica o novo limite',async()=>{
 let enviado;
 const {executar,estado}=rota(async()=>{enviado=estado.ultimoEstado.limitePico;});
 const res=resposta();await executar({body:{novoLimite:2000}},res);
 assert.equal(enviado,2000);assert.equal(res.body.publicado,true);assert.equal(estado.salvandoLimite,false);
});
test('limite salvo permanece disponível quando o broker falha',async()=>{
 const {executar,estado}=rota(async()=>{throw Error('offline');});
 const res=resposta();await executar({body:{novoLimite:2000}},res);
 assert.equal(res.body.publicado,false);assert.equal(estado.ultimoEstado.limitePico,2000);
});
test('validação e falha do banco não publicam configuração',async()=>{
 let publicacoes=0;
 const {executar,estado}=rota(async()=>publicacoes++,async()=>{throw Error('banco indisponível');});
 for(const value of [0,-1,'abc',null]){const res=resposta();await executar({body:{novoLimite:value}},res);assert.equal(res.code,400);}
 const res=resposta();await executar({body:{novoLimite:1500}},res);
 assert.equal(res.code,500);assert.equal(publicacoes,0);assert.equal(estado.salvandoLimite,false);
});
