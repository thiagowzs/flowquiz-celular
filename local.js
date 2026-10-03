"use strict";

// Versão de celular: faz, dentro do navegador, o papel do servidor Python.
//
// As questões chegam criptografadas (dados.bin), porque a hospedagem é pública e
// elas citam trechos das fontes. A chave sai da senha (PBKDF2) e fica guardada
// neste aparelho depois da primeira vez. O progresso fica no IndexedDB, e a
// agenda de revisão é refeita a partir do histórico a cada abertura.
//
// As regras de agenda, escolha e estatística espelham flowquiz/progresso.py e
// flowquiz/servidor.py: mudou lá, muda aqui.

window.FlowQuizLocal = (() => {
  const CFG = window.FLOWQUIZ_CELULAR;
  const DIA = 86400;
  const REVER_ERRO_EM = 10 * 60;
  const FACILIDADE_INICIAL = 2.5;
  const FACILIDADE_MINIMA = 1.3;
  const DOMINADA = 3;
  const FORMATO_BACKUP = "flowquiz-progresso";

  // ---------- IndexedDB ----------

  let conexao = null;

  function abrir() {
    conexao ??= new Promise((ok, falha) => {
      const pedido = indexedDB.open("flowquiz", 1);
      pedido.onupgradeneeded = () => {
        pedido.result.createObjectStore("tentativas", { autoIncrement: true });
        pedido.result.createObjectStore("valores"); // a chave da senha e os problemas marcados
      };
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => falha(pedido.error);
    });
    return conexao;
  }

  async function operar(loja, modo, fazer) {
    const db = await abrir();
    return new Promise((ok, falha) => {
      const tx = db.transaction(loja, modo);
      const pedido = fazer(tx.objectStore(loja));
      tx.oncomplete = () => ok(pedido ? pedido.result : undefined);
      tx.onerror = () => falha(tx.error);
      tx.onabort = () => falha(tx.error);
    });
  }

  const lerValor = (nome) => operar("valores", "readonly", (s) => s.get(nome));
  const gravarValor = (nome, valor) => operar("valores", "readwrite", (s) => { s.put(valor, nome); });
  const apagarValor = (nome) => operar("valores", "readwrite", (s) => { s.delete(nome); });

  // ---------- agenda (igual a proximo_agendamento em progresso.py) ----------

  function proximoAgendamento(estado, acertou, agora) {
    let [seguidos, intervalo, facilidade] = estado || [0, 0, FACILIDADE_INICIAL];
    if (!acertou) return [0, 0, Math.max(FACILIDADE_MINIMA, facilidade - 0.2), agora + REVER_ERRO_EM];
    seguidos += 1;
    if (seguidos === 1) intervalo = 1;
    else if (seguidos === 2) intervalo = 3;
    else intervalo = Math.round(intervalo * facilidade * 10) / 10;
    facilidade = Math.min(FACILIDADE_INICIAL, facilidade + 0.05);
    return [seguidos, intervalo, facilidade, agora + intervalo * DIA];
  }

  // ---------- estado em memória ----------

  let banco = null;       // { fontes: {id: {titulo, versao}}, questoes: Map(id → questão) }
  let categorias = new Map(); // tag → grupo, doenca, tema ou nivel (como em filtro.py)
  let tentativas = [];    // histórico, do mais antigo ao mais novo
  let agenda = new Map(); // id → [acertos seguidos, intervalo em dias, facilidade, próxima revisão]
  let problemas = new Set();

  function aplicar(t) {
    const anterior = agenda.get(t.questao);
    agenda.set(t.questao, proximoAgendamento(anterior ? anterior.slice(0, 3) : null, t.acertou, t.quando));
  }

  function refazerAgenda() {
    tentativas.sort((a, b) => a.quando - b.quando);
    agenda = new Map();
    tentativas.forEach(aplicar);
  }

  // ---------- senha e dados ----------

  const deBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
  const paraBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

  function erroDeSenha(mensagem) {
    const erro = new Error(mensagem);
    erro.codigo = "senha";
    return erro;
  }

  async function derivarChave(senha) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: deBase64(CFG.sal), iterations: CFG.iteracoes }, base, 256);
    return new Uint8Array(bits);
  }

  let cifrado = null;

  async function baixarCifrado() {
    if (!cifrado) {
      const resposta = await fetch(`dados.bin?v=${CFG.versao}`);
      if (!resposta.ok) throw new Error(`não consegui baixar as questões (erro ${resposta.status})`);
      cifrado = new Uint8Array(await resposta.arrayBuffer());
    }
    return cifrado;
  }

  // Lança OperationError se a chave não abre os dados (senha errada ou trocada).
  async function decifrar(chaveBruta) {
    const dados = await baixarCifrado();
    const chave = await crypto.subtle.importKey("raw", chaveBruta, "AES-GCM", false, ["decrypt"]);
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: dados.slice(0, 12) }, chave, dados.slice(12));
    return JSON.parse(new TextDecoder().decode(claro));
  }

  async function montar(dados) {
    banco = { fontes: dados.fontes, questoes: new Map(dados.questoes.map((q) => [q.id, q])) };
    categorias = categoriasDasTags(dados.questoes);
    tentativas = (await operar("tentativas", "readonly", (s) => s.getAll())) || [];
    refazerAgenda();
    problemas = new Set((await lerValor("problemas")) || []);
    // Pede ao navegador para não apagar estes dados quando faltar espaço.
    navigator.storage?.persist?.().catch(() => {});
  }

  let carregamento = null;

  function carregar() {
    carregamento ??= (async () => {
      if (!window.crypto?.subtle) throw new Error("este navegador não abre dados criptografados (a página precisa vir por https)");
      const guardada = await lerValor("chave");
      if (!guardada) throw erroDeSenha("");
      let dados;
      try {
        dados = await decifrar(deBase64(guardada));
      } catch (erro) {
        if (erro.name !== "OperationError") throw erro;
        await apagarValor("chave");
        throw erroDeSenha("A senha mudou. Digite a nova.");
      }
      await montar(dados);
    })().catch((erro) => {
      carregamento = null;
      throw erro;
    });
    return carregamento;
  }

  async function desbloquear(senha) {
    const chave = await derivarChave(senha);
    let dados;
    try {
      dados = await decifrar(chave);
    } catch (erro) {
      if (erro.name === "OperationError") throw new Error("Senha incorreta.");
      throw erro;
    }
    await gravarValor("chave", paraBase64(chave));
    await montar(dados);
    carregamento = Promise.resolve();
  }

  // ---------- regras (as mesmas do servidor) ----------

  const agora = () => Date.now() / 1000;
  const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const conjunto = (valor) => new Set((valor || "").split(",").filter(Boolean));

  function aprovadas() {
    return [...banco.questoes.values()].filter((q) => !problemas.has(q.id));
  }

  // ---------- filtro (igual a filtro.py) ----------

  const CATEGORIAS = ["grupo", "doenca", "tema", "nivel"];
  const NIVEIS = ["Fácil", "Média", "Difícil"];

  function categoriaDaPosicao(tag, posicao, total) {
    if (NIVEIS.includes(tag)) return "nivel";
    if (posicao === 0) return "grupo";
    if (total >= 3 && posicao === total - 2) return "tema";
    return "doenca";
  }

  function categoriasDasTags(questoes) {
    const votos = new Map();
    for (const q of questoes) {
      q.tags.forEach((tag, i) => {
        const c = categoriaDaPosicao(tag, i, q.tags.length);
        if (!votos.has(tag)) votos.set(tag, new Map());
        votos.get(tag).set(c, (votos.get(tag).get(c) || 0) + 1);
      });
    }
    return new Map([...votos].map(([tag, v]) => [tag, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  }

  // Dentro de uma categoria as escolhas somam; entre categorias, restringem.
  function filtrar(questoes, tags, fontes) {
    const porCategoria = new Map();
    for (const tag of tags) {
      const c = categorias.get(tag);
      if (!c) continue;
      if (!porCategoria.has(c)) porCategoria.set(c, new Set());
      porCategoria.get(c).add(tag);
    }
    return questoes.filter((q) =>
      [...porCategoria.values()].every((escolhidas) => q.tags.some((t) => escolhidas.has(t)))
      && (!fontes.size || q.fontes.some((c) => fontes.has(c.fonte))));
  }

  function contagensDoFiltro(questoes, tags, fontes) {
    const porTag = new Map([...categorias.keys()].map((t) => [t, 0]));
    for (const categoria of CATEGORIAS) {
      const outras = new Set([...tags].filter((t) => categorias.get(t) !== categoria));
      for (const q of filtrar(questoes, outras, fontes)) {
        for (const t of q.tags) if (categorias.get(t) === categoria) porTag.set(t, porTag.get(t) + 1);
      }
    }
    const porFonte = new Map();
    for (const q of filtrar(questoes, tags, new Set())) {
      for (const f of new Set(q.fontes.map((c) => c.fonte))) porFonte.set(f, (porFonte.get(f) || 0) + 1);
    }
    return [porTag, porFonte];
  }

  function noFiltro(params) {
    return filtrar(aprovadas(), conjunto(params.get("tags")), conjunto(params.get("fontes")));
  }

  function contagem(ids, instante = agora()) {
    let pendentes = 0;
    let novas = 0;
    let proxima = null;
    for (const id of ids) {
      const estado = agenda.get(id);
      if (!estado) novas += 1;
      else if (estado[3] <= instante) pendentes += 1;
      else if (proxima === null || estado[3] < proxima) proxima = estado[3];
    }
    return { pendentes, novas, proxima };
  }

  // Primeiro a revisão mais atrasada, depois uma nunca vista; no modo livre, qualquer uma.
  function escolher(ids, evitar, livre, instante = agora()) {
    let candidatas = ids.filter((i) => i !== evitar);
    if (!candidatas.length) candidatas = ids.slice();
    let vencida = null;
    for (const id of candidatas) {
      const estado = agenda.get(id);
      if (estado && estado[3] <= instante && (!vencida || estado[3] < vencida[0] || (estado[3] === vencida[0] && id < vencida[1]))) {
        vencida = [estado[3], id];
      }
    }
    if (vencida) return vencida[1];
    const novas = candidatas.filter((id) => !agenda.has(id));
    if (novas.length) return sortear(novas);
    if (livre && candidatas.length) return sortear(candidatas);
    return null;
  }

  function embaralhar(lista) {
    for (let i = lista.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    return lista;
  }

  function paraCliente(q) {
    const ordem = q.alternativas.map((_, i) => i);
    if (q.embaralhar) embaralhar(ordem);
    return {
      id: q.id, tipo: q.tipo, enunciado: q.enunciado, tags: q.tags,
      alternativas: ordem.map((i) => ({ i, texto: q.alternativas[i] })),
    };
  }

  function correcao(q, resposta) {
    const acertou = resposta.length === q.gabarito.length && resposta.every((v, k) => v === q.gabarito[k]);
    return {
      id: q.id, acertou, resposta, gabarito: q.gabarito, explicacao: q.explicacao,
      fontes: q.fontes.map((c) => ({
        fonte: c.fonte,
        titulo: banco.fontes[c.fonte]?.titulo || c.fonte,
        versao: banco.fontes[c.fonte]?.versao || "",
        pagina: c.pagina ?? null,
        secao: c.secao || "",
        trecho: c.trecho,
      })),
    };
  }

  function lerResposta(valor, q) {
    if (!Array.isArray(valor) || !valor.every((i) => Number.isInteger(i) && i >= 0 && i < q.alternativas.length)) return null;
    return [...new Set(valor)].sort((a, b) => a - b);
  }

  async function registrar(questao, acertou, modo, tempoMs = null) {
    const t = { questao, quando: agora(), acertou, modo, tempo_ms: tempoMs };
    await operar("tentativas", "readwrite", (s) => { s.add(t); });
    tentativas.push(t);
    aplicar(t);
  }

  function estatisticas() {
    const meiaNoite = new Date();
    meiaNoite.setHours(0, 0, 0, 0);
    const porQuestao = new Map();
    let hoje = 0;
    for (const t of tentativas) {
      const [n, a] = porQuestao.get(t.questao) || [0, 0];
      porQuestao.set(t.questao, [n + 1, a + (t.acertou ? 1 : 0)]);
      if (t.quando >= meiaNoite.getTime() / 1000) hoje += 1;
    }
    const zerado = (extra = {}) => ({ respondidas: 0, acertos: 0, questoes: 0, dominadas: 0, ...extra });
    const geral = zerado();
    const temas = new Map();
    for (const q of aprovadas()) {
      const [respondidas, acertos] = porQuestao.get(q.id) || [0, 0];
      const dominada = (agenda.get(q.id)?.[0] || 0) >= DOMINADA ? 1 : 0;
      const alvos = [geral, ...(q.tags.length ? q.tags : ["(sem tema)"]).map((tag) => {
        if (!temas.has(tag)) temas.set(tag, zerado({ tag }));
        return temas.get(tag);
      })];
      for (const alvo of alvos) {
        alvo.respondidas += respondidas;
        alvo.acertos += acertos;
        alvo.questoes += 1;
        alvo.dominadas += dominada;
      }
    }
    const taxa = (t) => (t.respondidas ? t.acertos / t.respondidas : 0);
    const porTag = [...temas.values()].sort((x, y) =>
      (x.respondidas === 0) - (y.respondidas === 0) || taxa(x) - taxa(y) || comparar(x.tag.toLowerCase(), y.tag.toLowerCase()));
    return { ...geral, hoje, por_tag: porTag };
  }

  // ---------- backup (mesmo formato do PC) ----------

  function lerBackup(dados) {
    if (!dados || typeof dados !== "object" || dados.formato !== FORMATO_BACKUP) {
      throw new Error("este arquivo não é um backup do FlowQuiz");
    }
    if (!Array.isArray(dados.tentativas) || !Array.isArray(dados.problemas ?? [])) {
      throw new Error("backup incompleto: faltam as tentativas");
    }
    const tentativasLidas = dados.tentativas.map((t) => {
      const ok = t && typeof t.questao === "string" && typeof t.quando === "number" && typeof t.acertou === "boolean"
        && typeof t.modo === "string" && (t.tempo_ms === null || t.tempo_ms === undefined || Number.isInteger(t.tempo_ms));
      if (!ok) throw new Error("backup com uma tentativa inválida");
      return { questao: t.questao, quando: t.quando, acertou: t.acertou, modo: t.modo, tempo_ms: t.tempo_ms ?? null };
    });
    return [tentativasLidas, (dados.problemas || []).filter((p) => typeof p === "string")];
  }

  async function importar(dados) {
    const [novasLidas, problemasLidos] = lerBackup(dados);
    const vistas = new Set(tentativas.map((t) => `${t.questao}|${t.quando.toFixed(3)}`));
    const novas = [];
    for (const t of novasLidas) {
      const chave = `${t.questao}|${t.quando.toFixed(3)}`;
      if (!vistas.has(chave)) {
        vistas.add(chave);
        novas.push(t);
      }
    }
    if (novas.length) {
      await operar("tentativas", "readwrite", (s) => { for (const t of novas) s.add(t); });
      tentativas.push(...novas);
      refazerAgenda();
    }
    const antes = problemas.size;
    problemasLidos.forEach((p) => problemas.add(p));
    if (problemas.size !== antes) await gravarValor("problemas", [...problemas]);
    return { novas: novas.length, devolvidas: problemas.size - antes };
  }

  // ---------- rotas: as mesmas URLs da API do servidor ----------

  async function api(caminho, corpo) {
    await carregar();
    const url = new URL(caminho, location.href);
    const rota = url.pathname.slice(url.pathname.indexOf("/api/"));
    const params = url.searchParams;

    if (rota === "/api/inicio") {
      const todas = aprovadas();
      const tags = conjunto(params.get("tags"));
      const fontes = conjunto(params.get("fontes"));
      const filtradas = filtrar(todas, tags, fontes);
      const [porTag, porFonte] = contagensDoFiltro(todas, tags, fontes);
      const todasFontes = [...new Set(todas.flatMap((q) => q.fontes.map((c) => c.fonte)))].sort(comparar);
      return {
        aprovadas: todas.length, no_filtro: filtradas.length, rascunhos: 0, erros: 0,
        tags: [...categorias.keys()].sort((a, b) => comparar(a.toLowerCase(), b.toLowerCase()))
          .map((tag) => ({ tag, n: porTag.get(tag), categoria: categorias.get(tag) })),
        fontes: todasFontes.map((id) => ({ id, titulo: banco.fontes[id]?.titulo || id, n: porFonte.get(id) || 0 })),
        contagem: contagem(filtradas.map((q) => q.id)),
      };
    }
    if (rota === "/api/estudo/proxima") {
      const ids = noFiltro(params).map((q) => q.id);
      const escolhida = escolher(ids, params.get("evitar"), params.get("livre") === "1");
      return { questao: escolhida ? paraCliente(banco.questoes.get(escolhida)) : null, contagem: contagem(ids) };
    }
    if (rota === "/api/responder") {
      const q = banco.questoes.get(corpo?.id);
      if (!q) throw new Error("questão não encontrada");
      const resposta = lerResposta(corpo.resposta, q);
      if (!resposta) throw new Error("resposta inválida");
      const resultado = correcao(q, resposta);
      await registrar(q.id, resultado.acertou, "estudo", Number.isInteger(corpo.tempo_ms) ? corpo.tempo_ms : null);
      return resultado;
    }
    if (rota === "/api/simulado") {
      const n = Math.max(1, Number(params.get("n")) || 20);
      return { questoes: embaralhar(noFiltro(params)).slice(0, n).map(paraCliente) };
    }
    if (rota === "/api/simulado/corrigir") {
      const resultados = [];
      for (const item of corpo?.respostas || []) {
        const q = banco.questoes.get(item?.id);
        if (!q) continue;
        const resultado = correcao(q, lerResposta(item.resposta, q) || []); // em branco conta como erro
        await registrar(q.id, resultado.acertou, "simulado");
        resultados.push(resultado);
      }
      return { resultados, total: resultados.length, acertos: resultados.filter((r) => r.acertou).length };
    }
    if (rota === "/api/estatisticas") return estatisticas();
    if (rota.startsWith("/api/revisao/")) {
      // "Achei um problema": a questão sai do quiz neste aparelho e vai no backup para o PC.
      problemas.add(decodeURIComponent(rota.slice("/api/revisao/".length)));
      await gravarValor("problemas", [...problemas]);
      return { ok: true };
    }
    if (rota === "/api/progresso") {
      return {
        formato: FORMATO_BACKUP, versao: 1, origem: "celular", exportado_em: agora(),
        tentativas: tentativas.map((t) => ({ questao: t.questao, quando: t.quando, acertou: t.acertou, modo: t.modo, tempo_ms: t.tempo_ms ?? null })),
        problemas: [...problemas],
      };
    }
    if (rota === "/api/progresso/importar") return importar(corpo);
    throw new Error("isto não existe na versão de celular");
  }

  function info() {
    return {
      versao: CFG.versao, gerado_em: CFG.gerado_em,
      questoes: banco ? banco.questoes.size : CFG.questoes,
      problemas: problemas.size, tentativas: tentativas.length,
    };
  }

  // ---------- funcionar sem internet ----------

  if ("serviceWorker" in navigator) {
    const jaTinhaVersao = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register("sw.js").then((registro) => registro.update()).catch(() => {});
    // Versão nova baixada em segundo plano: entra já, se a pessoa estiver na tela inicial.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (jaTinhaVersao && (location.hash === "" || location.hash === "#/")) location.reload();
    });
  }

  return { api, desbloquear, info };
})();
