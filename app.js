"use strict";

const app = document.getElementById("app");
const LETRAS = "ABCDEFGHIJ";
const ROTULO_TIPO = { unica: "uma correta", multipla: "várias corretas", vf: "verdadeiro ou falso" };
// Na versão de celular (local.js) não há servidor: as mesmas rotas da API rodam aqui dentro.
const LOCAL = window.FlowQuizLocal || null;

// ---------- utilidades ----------

// Monta elementos com textContent, nunca innerHTML: enunciados têm "<" e ">" ("MPO <10%").
function el(tag, props, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === "class") no.className = valor;
    else if (chave === "dataset") Object.assign(no.dataset, valor);
    else if (chave.startsWith("on")) no.addEventListener(chave.slice(2), valor);
    else no.setAttribute(chave, valor === true ? "" : valor);
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return no;
}

async function api(caminho, corpo) {
  if (LOCAL) return LOCAL.api(caminho, corpo);
  const opcoes = corpo === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  };
  const resposta = await fetch(caminho, opcoes);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `erro ${resposta.status}`);
  return dados;
}

function toast(texto) {
  const aviso = el("div", { class: "toast", role: "status" }, texto);
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), 3000);
}

function emQuanto(timestamp) {
  const s = timestamp - Date.now() / 1000;
  if (s < 60) return "menos de 1 min";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const dias = Math.round(s / 86400);
  return `${dias} dia${dias > 1 ? "s" : ""}`;
}

function relogio(segundos) {
  const m = Math.floor(segundos / 60);
  return `${m}:${String(segundos % 60).padStart(2, "0")}`;
}

function pct(acertos, total) {
  return total ? Math.round((100 * acertos) / total) : 0;
}

// Troca o conteúdo da tela. Aceita listas e ignora null, como el().
function tela(...nos) {
  app.replaceChildren(...nos.flat().filter((no) => no !== null && no !== undefined && no !== false));
}

function cabecalho(titulo, direita, aoVoltar) {
  return el("div", {},
    el("div", { class: "barra-topo" }, el("a", { href: "#/", onclick: aoVoltar }, "← Início"), direita),
    el("h1", {}, titulo));
}

function numero(valor, rotulo) {
  return el("div", { class: "numero" }, el("strong", {}, valor), el("span", { class: "suave" }, rotulo));
}

// ---------- filtro (lembrado neste navegador) ----------

const CHAVE_FILTRO = "flowquiz.filtro";
let filtro = { tags: [], fontes: [] };
try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE_FILTRO));
  if (salvo && Array.isArray(salvo.tags) && Array.isArray(salvo.fontes)) filtro = salvo;
} catch { /* sem localStorage: filtro só desta visita */ }

// Seções recolhíveis do filtro que estão abertas (sobrevive ao redesenho da tela).
const secoesAbertas = new Set();

function salvarFiltro() {
  try { localStorage.setItem(CHAVE_FILTRO, JSON.stringify(filtro)); } catch { /* idem */ }
}

function paramsFiltro(extra = {}) {
  const p = new URLSearchParams();
  if (filtro.tags.length) p.set("tags", filtro.tags.join(","));
  if (filtro.fontes.length) p.set("fontes", filtro.fontes.join(","));
  for (const [chave, valor] of Object.entries(extra)) if (valor !== null && valor !== undefined) p.set(chave, valor);
  return p.toString();
}

// ---------- teclado: letras/números escolhem, Enter confirma ----------

let atalhos = null;
document.addEventListener("keydown", (e) => {
  if (!atalhos || e.ctrlKey || e.metaKey || e.altKey || e.target.matches("input, select, textarea")) return;
  if (e.key === "Enter") {
    e.preventDefault();
    atalhos.confirmar?.();
    return;
  }
  if (e.key.length !== 1 || !atalhos.alternativa) return;
  const letra = "abcdefghij".indexOf(e.key.toLowerCase());
  const posicao = letra >= 0 ? letra : "123456789".indexOf(e.key);
  if (posicao >= 0) {
    e.preventDefault();
    atalhos.alternativa(posicao);
  }
});

// ---------- componentes ----------

function cartaoQuestao(q, { selecionadas = [], aoMudar, numero: n } = {}) {
  const escolhidas = new Set(selecionadas);
  const multipla = q.tipo === "multipla";
  let travado = false;

  const botoes = q.alternativas.map((alt, pos) => el("button", {
    class: "alternativa", type: "button", onclick: () => alternar(pos),
  }, el("span", { class: "letra" }, LETRAS[pos]), el("span", { class: "texto" }, alt.texto)));

  function pintar() {
    botoes.forEach((b, pos) => b.classList.toggle("selecionada", escolhidas.has(q.alternativas[pos].i)));
  }

  function alternar(pos) {
    if (travado || pos >= q.alternativas.length) return;
    const i = q.alternativas[pos].i;
    if (multipla) {
      if (escolhidas.has(i)) escolhidas.delete(i); else escolhidas.add(i);
    } else {
      escolhidas.clear();
      escolhidas.add(i);
    }
    pintar();
    aoMudar?.([...escolhidas]);
  }

  pintar();
  const no = el("article", { class: "cartao questao" },
    n ? el("p", { class: "numero-questao" }, `Questão ${n}`) : null,
    q.tags.length ? el("div", { class: "tags" }, q.tags.map((t) => el("span", { class: "tag" }, t))) : null,
    el("p", { class: "enunciado" }, q.enunciado),
    multipla ? el("p", { class: "dica" }, "Marque todas as corretas.") : null,
    el("div", { class: "alternativas" }, botoes));

  return {
    no,
    alternar,
    resposta: () => [...escolhidas],
    corrigir(correcao) {
      travado = true;
      const certas = new Set(correcao.gabarito);
      botoes.forEach((b, pos) => {
        const i = q.alternativas[pos].i;
        b.disabled = true;
        b.classList.remove("selecionada");
        if (certas.has(i)) b.classList.add(escolhidas.has(i) ? "correta" : "faltou");
        else if (escolhidas.has(i)) b.classList.add("errada");
      });
      no.append(blocoCorrecao(correcao));
    },
  };
}

function blocoCorrecao(c) {
  return el("section", { class: `correcao ${c.acertou ? "ok" : "erro"}` },
    el("p", { class: "veredito" }, c.acertou ? "✓ Correto" : "✗ Incorreto"),
    el("p", { class: "explicacao" }, c.explicacao),
    c.fontes.map(blocoFonte));
}

function blocoFonte(f) {
  const referencia = [
    f.titulo + (f.versao ? ` (${f.versao})` : ""),
    f.pagina ? `p. ${f.pagina}` : null,
    f.secao || null,
  ].filter(Boolean).join(" · ");
  return el("figure", { class: "fonte" }, el("blockquote", {}, f.trecho), el("figcaption", {}, referencia));
}

function botaoProblema(id) {
  const botao = el("button", {
    class: "discreto",
    onclick: async () => {
      const pergunta = LOCAL
        ? "Marcar esta questão com problema? Ela sai do quiz neste celular e vai no backup para ser revista no PC."
        : "Devolver esta questão para a revisão? Ela sai do quiz até ser aprovada de novo.";
      if (!confirm(pergunta)) return;
      try {
        await api(`/api/revisao/${encodeURIComponent(id)}`, { status: "rascunho" });
        botao.disabled = true;
        botao.textContent = LOCAL ? "Marcada com problema" : "Devolvida para a revisão";
      } catch (erro) {
        toast(`Não deu certo: ${erro.message}`);
      }
    },
  }, "Achei um problema");
  return botao;
}

// ---------- tela: início ----------

async function telaInicio() {
  const d = await api(`/api/inicio?${paramsFiltro()}`);

  // Tema ou fonte que sumiu do banco não pode continuar filtrando.
  const tags = new Set(d.tags.map((t) => t.tag));
  const fontes = new Set(d.fontes.map((f) => f.id));
  const antes = JSON.stringify(filtro);
  filtro = { tags: filtro.tags.filter((t) => tags.has(t)), fontes: filtro.fontes.filter((f) => fontes.has(f)) };
  if (JSON.stringify(filtro) !== antes) {
    salvarFiltro();
    return telaInicio();
  }

  const blocos = [el("h1", {}, "FlowQuiz"), dicaInstalar()];
  if (d.erros) {
    blocos.push(el("p", { class: "cartao aviso" },
      `${d.erros} problema(s) no banco de questões. `, el("a", { href: "#/revisao" }, "Ver na revisão")));
  }

  if (!d.aprovadas && LOCAL) {
    blocos.push(el("section", { class: "cartao" },
      el("h2", {}, "Nenhuma questão disponível"),
      el("p", { class: "suave" }, "Todas foram marcadas com problema neste celular. Exporte o backup e importe no PC.")),
    el("a", { class: "botao", href: "#/backup" }, "Backup"));
    tela(...blocos);
    return;
  }
  if (!d.aprovadas) {
    blocos.push(el("section", { class: "cartao" },
      el("h2", {}, "Nenhuma questão aprovada ainda"),
      el("p", { class: "suave" }, d.rascunhos
        ? `Há ${d.rascunhos} rascunho(s) esperando revisão.`
        : "Cadastre os capítulos na tela Fontes e peça as questões ao Claude Code."),
      el("div", { class: "linha" },
        d.rascunhos ? el("a", { class: "botao primario", href: "#/revisao" }, "Revisar rascunhos") : null,
        el("a", { class: `botao${d.rascunhos ? "" : " primario"}`, href: "#/fontes" }, "Fontes"))));
    tela(...blocos);
    return;
  }

  const c = d.contagem;
  let resumo;
  if (c.pendentes || c.novas) resumo = `${c.pendentes} para revisar · ${c.novas} nova(s)`;
  else if (c.proxima) resumo = `Tudo em dia. Próxima revisão em ${emQuanto(c.proxima)}.`;
  else resumo = "Nenhuma questão neste filtro.";
  blocos.push(el("section", { class: "cartao" },
    el("h2", {}, "Estudar"),
    el("p", { class: "suave" }, resumo),
    el("a", { class: "botao primario", href: "#/estudo" }, "Começar")));

  const tamanhos = [10, 20, 30, 50].filter((n) => n < d.no_filtro).concat(d.no_filtro);
  const padrao = Math.min(20, d.no_filtro);
  const seletor = el("select", { "aria-label": "Número de questões" }, tamanhos.map((n) =>
    el("option", { value: n, selected: n === padrao }, n === d.no_filtro ? `Todas (${n})` : `${n} questões`)));
  blocos.push(el("section", { class: "cartao" },
    el("h2", {}, "Simulado"),
    el("p", { class: "suave" }, "Questões sorteadas, com a correção só no final."),
    el("div", { class: "linha" }, seletor, el("button", {
      class: "primario", disabled: !d.no_filtro,
      onclick: () => { location.hash = `#/simulado?n=${seletor.value}`; },
    }, "Iniciar"))));

  const filtrando = filtro.tags.length || filtro.fontes.length;
  const chip = (texto, ativo, aoClicar) => el("button", { class: `chip${ativo ? " ativo" : ""}`, "aria-pressed": String(ativo), onclick: aoClicar }, texto);
  const alternarFiltro = (campo, valor) => {
    filtro[campo] = filtro[campo].includes(valor) ? filtro[campo].filter((v) => v !== valor) : [...filtro[campo], valor];
    salvarFiltro();
    telaInicio().catch(mostrarErro);
  };
  // Cada opção mostra quantas questões teria com as escolhas das outras seções;
  // as que dariam zero somem, então escolher um grupo encolhe a lista de doenças.
  const opcoesTag = (categoria) => d.tags.filter((t) => (t.categoria || "tema") === categoria).map((t) => ({
    texto: t.tag, n: t.n, ativo: filtro.tags.includes(t.tag), clicar: () => alternarFiltro("tags", t.tag),
  }));
  const ordemNivel = ["Fácil", "Média", "Difícil"];
  const secao = (chave, titulo, opcoes, recolhida) => {
    const visiveis = opcoes.filter((o) => o.n > 0 || o.ativo);
    if (!visiveis.length) return null;
    const chips = el("div", { class: "chips" }, visiveis.map((o) => chip(`${o.texto} (${o.n})`, o.ativo, o.clicar)));
    if (!recolhida) return [el("h3", {}, titulo), chips];
    const escolhidas = visiveis.filter((o) => o.ativo).length;
    return el("details", {
      class: "secao-filtro", open: secoesAbertas.has(chave),
      ontoggle: (e) => { if (e.target.open) secoesAbertas.add(chave); else secoesAbertas.delete(chave); },
    },
    el("summary", {}, titulo, el("span", { class: "suave" },
      escolhidas ? ` · ${escolhidas} escolhida(s)` : ` · ${visiveis.length} opções`)),
    chips);
  };
  blocos.push(el("section", { class: "cartao" },
    el("h2", {}, "Filtros"),
    el("p", { class: "suave" }, filtrando
      ? `${d.no_filtro} de ${d.aprovadas} questões no filtro. Vale para o estudo e o simulado.`
      : `Todas as ${d.aprovadas} questões. Escolha um grupo, uma dificuldade ou abra as outras seções para focar.`),
    secao("grupo", "Grupo", opcoesTag("grupo"), false),
    secao("nivel", "Dificuldade", opcoesTag("nivel").sort((a, b) => ordemNivel.indexOf(a.texto) - ordemNivel.indexOf(b.texto)), false),
    secao("doenca", "Doença", opcoesTag("doenca"), true),
    secao("tema", "Tema", opcoesTag("tema"), true),
    d.fontes.length > 1 ? secao("fontes", "Fontes (capítulos)", d.fontes.map((f) => ({
      texto: f.titulo, n: f.n, ativo: filtro.fontes.includes(f.id), clicar: () => alternarFiltro("fontes", f.id),
    })), true) : null,
    filtrando ? el("p", { class: "limpar" }, el("button", {
      class: "discreto", onclick: () => { filtro = { tags: [], fontes: [] }; salvarFiltro(); telaInicio().catch(mostrarErro); },
    }, "Limpar filtros")) : null));

  blocos.push(el("nav", { class: "linha" },
    el("a", { class: "botao", href: "#/desempenho" }, "Desempenho"),
    LOCAL ? null : el("a", { class: "botao", href: "#/revisao" }, `Revisar rascunhos${d.rascunhos ? ` (${d.rascunhos})` : ""}`),
    LOCAL ? null : el("a", { class: "botao", href: "#/fontes" }, "Fontes"),
    el("a", { class: "botao", href: "#/backup" }, "Backup")));
  if (LOCAL) {
    const i = LOCAL.info();
    blocos.push(el("p", { class: "suave pequeno rodape" }, `${i.questoes.toLocaleString("pt-BR")} questões · versão de ${i.gerado_em}`));
  }
  tela(...blocos);
}

// ---------- tela: estudo ----------

async function telaEstudo() {
  const sessao = { respondidas: 0, acertos: 0, ultima: null, livre: false };

  function placar(c) {
    const partes = [];
    if (sessao.respondidas) partes.push(`${sessao.acertos}/${sessao.respondidas} certas`);
    if (!sessao.livre) partes.push(`${c.pendentes} para revisar · ${c.novas} nova(s)`);
    return partes.join(" · ");
  }

  async function proxima() {
    atalhos = null;
    try {
      const d = await api(`/api/estudo/proxima?${paramsFiltro({ evitar: sessao.ultima, livre: sessao.livre ? 1 : null })}`);
      if (d.questao) mostrar(d.questao, d.contagem); else fim(d.contagem);
    } catch (erro) {
      mostrarErro(erro);
    }
  }

  function mostrar(q, contagem) {
    const inicio = performance.now();
    const botao = el("button", { class: "primario", disabled: true }, "Responder");
    const cartao = cartaoQuestao(q, { aoMudar: (r) => { botao.disabled = !r.length; } });
    const acoes = el("div", { class: "acoes" }, botao);
    const placarEl = el("span", {}, placar(contagem));

    async function responder() {
      if (botao.disabled) return;
      botao.disabled = true;
      atalhos = null;
      let correcao;
      try {
        correcao = await api("/api/responder", {
          id: q.id, resposta: cartao.resposta(), tempo_ms: Math.round(performance.now() - inicio),
        });
      } catch (erro) {
        toast(`Não deu certo: ${erro.message}`);
        botao.disabled = false;
        atalhos = { alternativa: cartao.alternar, confirmar: responder };
        return;
      }
      sessao.respondidas += 1;
      if (correcao.acertou) sessao.acertos += 1;
      sessao.ultima = q.id;
      placarEl.textContent = placar(contagem);
      cartao.corrigir(correcao);
      const seguir = el("button", { class: "primario", onclick: proxima }, "Próxima");
      acoes.replaceChildren(seguir, botaoProblema(q.id));
      seguir.focus({ preventScroll: true });
      atalhos = { confirmar: proxima };
    }

    botao.addEventListener("click", responder);
    tela(cabecalho(sessao.livre ? "Prática livre" : "Estudar", placarEl), cartao.no, acoes);
    atalhos = { alternativa: cartao.alternar, confirmar: responder };
    window.scrollTo(0, 0);
  }

  function fim(c) {
    const sessaoTexto = sessao.respondidas ? `Nesta sessão: ${sessao.acertos} de ${sessao.respondidas} certas.` : null;
    const semQuestoes = sessao.livre || (!c.proxima && !c.pendentes && !c.novas);
    tela(cabecalho("Estudar"), el("section", { class: "cartao" },
      el("h2", {}, semQuestoes ? "Nenhuma questão neste filtro" : "Tudo em dia"),
      sessaoTexto ? el("p", {}, sessaoTexto) : null,
      !semQuestoes && c.proxima ? el("p", { class: "suave" }, `A próxima revisão vence em ${emQuanto(c.proxima)}.`) : null,
      el("div", { class: "linha" },
        semQuestoes ? null : el("button", {
          class: "primario", onclick: () => { sessao.livre = true; proxima(); },
        }, "Praticar mesmo assim"),
        el("a", { class: "botao", href: "#/" }, "Início"))));
  }

  await proxima();
}

// ---------- tela: simulado ----------

async function telaSimulado(n) {
  const { questoes } = await api(`/api/simulado?${paramsFiltro({ n })}`);
  if (!questoes.length) {
    tela(cabecalho("Simulado"), el("p", { class: "cartao" }, "Nenhuma questão aprovada neste filtro."));
    return;
  }
  const respostas = new Map();
  const inicio = Date.now();
  let atual = 0;
  const relogioEl = el("span", {}, "0:00");
  const cronometro = setInterval(() => {
    relogioEl.textContent = relogio(Math.floor((Date.now() - inicio) / 1000));
  }, 1000);
  aoSair = () => clearInterval(cronometro);

  const respondidas = () => [...respostas.values()].filter((r) => r.length).length;
  const confirmarSaida = (e) => {
    if (respondidas() && !confirm("Abandonar o simulado? As respostas não serão salvas.")) e.preventDefault();
  };
  const ir = (i) => { atual = i; render(); };

  function render() {
    const q = questoes[atual];
    const ultima = atual === questoes.length - 1;
    const paleta = el("div", { class: "paleta" }, questoes.map((outra, i) => el("button", {
      class: [(respostas.get(outra.id) || []).length ? "respondida" : "", i === atual ? "atual" : ""].join(" ").trim() || null,
      "aria-label": `Questão ${i + 1}`,
      onclick: () => ir(i),
    }, String(i + 1))));
    const progressoEl = el("p", { class: "suave pequeno" }, `${respondidas()} de ${questoes.length} respondidas`);
    const cartao = cartaoQuestao(q, {
      selecionadas: respostas.get(q.id) || [],
      aoMudar: (r) => {
        respostas.set(q.id, r);
        paleta.children[atual].classList.toggle("respondida", r.length > 0);
        progressoEl.textContent = `${respondidas()} de ${questoes.length} respondidas`;
      },
    });
    tela(
      cabecalho(`Simulado · ${atual + 1} de ${questoes.length}`, relogioEl, confirmarSaida),
      cartao.no,
      el("div", { class: "acoes" },
        el("button", { disabled: atual === 0, onclick: () => ir(atual - 1) }, "Anterior"),
        ultima
          ? el("button", { class: "primario", onclick: finalizar }, "Finalizar")
          : el("button", { class: "primario", onclick: () => ir(atual + 1) }, "Próxima")),
      el("section", { class: "cartao" },
        progressoEl,
        paleta,
        ultima ? null : el("button", { class: "discreto", onclick: finalizar }, "Finalizar agora")));
    atalhos = { alternativa: cartao.alternar, confirmar: () => (ultima ? finalizar() : ir(atual + 1)) };
  }

  async function finalizar() {
    const faltam = questoes.length - respondidas();
    if (faltam && !confirm(`${faltam} questão(ões) sem resposta vão contar como erro. Finalizar mesmo assim?`)) return;
    atalhos = null;
    const segundos = Math.floor((Date.now() - inicio) / 1000);
    let r;
    try {
      r = await api("/api/simulado/corrigir", {
        respostas: questoes.map((q) => ({ id: q.id, resposta: respostas.get(q.id) || [] })),
      });
    } catch (erro) {
      toast(`Não deu certo: ${erro.message}`);
      render();
      return;
    }
    clearInterval(cronometro);
    aoSair = null;
    resultado(r, segundos);
  }

  function resultado(r, segundos) {
    const porId = new Map(r.resultados.map((c) => [c.id, c]));
    const cartoes = questoes.map((q, i) => {
      const c = porId.get(q.id);
      const cartao = cartaoQuestao(q, { selecionadas: respostas.get(q.id) || [], numero: i + 1 });
      if (c) cartao.corrigir(c);
      else cartao.no.append(el("p", { class: "suave" }, "Esta questão saiu do banco e não foi corrigida."));
      cartao.no.dataset.acertou = c && c.acertou ? "1" : "0";
      return cartao.no;
    });
    const soErradas = el("input", {
      type: "checkbox",
      onchange: () => cartoes.forEach((no) => { no.hidden = soErradas.checked && no.dataset.acertou === "1"; }),
    });
    tela(
      cabecalho("Resultado do simulado"),
      el("section", { class: "cartao" },
        el("div", { class: "numeros" },
          numero(`${pct(r.acertos, r.total)}%`, "de acerto"),
          numero(`${r.acertos}/${r.total}`, "questões certas"),
          numero(relogio(segundos), "de prova")),
        el("label", { class: "linha" }, soErradas, "Mostrar só as que errei")),
      cartoes,
      el("div", { class: "acoes" }, el("a", { class: "botao primario", href: "#/" }, "Início")));
    window.scrollTo(0, 0);
  }

  render();
}

// ---------- tela: desempenho ----------

async function telaDesempenho() {
  const d = await api("/api/estatisticas");
  const linhas = d.por_tag.map((t) => el("tr", {},
    el("td", {}, t.tag, el("div", { class: "suave pequeno" }, `${t.questoes} questão(ões)`)),
    el("td", {}, t.respondidas
      ? [el("div", { class: "barra" }, el("span", { style: `width: ${pct(t.acertos, t.respondidas)}%` })),
         el("div", { class: "pequeno" }, `${pct(t.acertos, t.respondidas)}% de ${t.respondidas}`)]
      : el("span", { class: "suave pequeno" }, "ainda não respondido")),
    el("td", {}, `${t.dominadas}/${t.questoes}`)));
  tela(
    cabecalho("Desempenho"),
    el("section", { class: "cartao" }, el("div", { class: "numeros" },
      numero(d.respondidas ? `${pct(d.acertos, d.respondidas)}%` : "—", "de acerto geral"),
      numero(String(d.respondidas), "respostas no total"),
      numero(String(d.hoje), "respostas hoje"),
      numero(`${d.dominadas}/${d.questoes}`, "questões dominadas"))),
    d.por_tag.length ? el("section", { class: "cartao" },
      el("h2", {}, "Por tema"),
      el("p", { class: "suave pequeno" }, "Pontos fracos primeiro. Dominada = 3 acertos seguidos."),
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Tema"), el("th", {}, "Acerto"), el("th", {}, "Dominadas"))),
        el("tbody", {}, linhas))) : null);
}

// ---------- tela: revisão de rascunhos ----------

async function telaRevisao() {
  const d = await api("/api/revisao");
  let restantes = d.rascunhos.length;
  const contador = el("span", {}, `${restantes} rascunho(s)`);
  const blocos = [cabecalho("Revisar rascunhos", contador)];
  if (d.erros.length) {
    blocos.push(el("section", { class: "cartao aviso" },
      el("h2", {}, "Questões com erro (fora do quiz)"),
      el("ul", {}, d.erros.map((e) => el("li", {}, e))),
      el("p", { class: "pequeno" }, "Corrija no arquivo JSON e recarregue a página.")));
  }
  if (!restantes) blocos.push(el("p", { class: "cartao" }, "Nenhum rascunho esperando revisão."));
  for (const q of d.rascunhos) {
    blocos.push(cartaoRevisao(q, () => {
      restantes -= 1;
      contador.textContent = `${restantes} rascunho(s)`;
    }));
  }
  tela(...blocos);
}

function cartaoRevisao(q, aoDecidir) {
  const certas = new Set(q.gabarito);
  const comProblema = q.fontes.filter((f) => f.verificacao.situacao !== "ok").length;
  const no = el("article", { class: "cartao questao" },
    el("div", { class: "meta" }, `${q.id} · ${q.arquivo} · ${ROTULO_TIPO[q.tipo]}`),
    q.tags.length ? el("div", { class: "tags" }, q.tags.map((t) => el("span", { class: "tag" }, t))) : null,
    el("p", { class: "enunciado" }, q.enunciado),
    el("ol", { class: "lista-alternativas" }, q.alternativas.map((texto, i) =>
      el("li", { class: certas.has(i) ? "certa" : null }, el("span", { class: "letra" }, LETRAS[i]), el("span", {}, texto)))),
    el("p", { class: "explicacao" }, el("strong", {}, "Explicação: "), q.explicacao),
    q.fontes.map((f) => el("div", {}, blocoFonte(f),
      el("p", { class: `selo ${f.verificacao.situacao === "ok" ? "ok" : "problema"}` },
        f.verificacao.situacao === "ok" ? "✓ " : "⚠ ", f.verificacao.mensagem))),
    el("div", { class: "acoes" },
      el("button", { class: "primario", onclick: () => decidir("aprovada") }, "Aprovar"),
      el("button", { onclick: () => decidir("rejeitada") }, "Rejeitar")));

  async function decidir(status) {
    if (status === "aprovada" && comProblema
        && !confirm("A verificação encontrou problema na citação. Aprovar mesmo assim?")) return;
    try {
      await api(`/api/revisao/${encodeURIComponent(q.id)}`, { status });
    } catch (erro) {
      toast(`Não deu certo: ${erro.message}`);
      return;
    }
    no.classList.add("decidida");
    no.replaceChildren(el("p", { class: "suave" }, `${q.id}: ${status}.`));
    aoDecidir();
  }
  return no;
}

// ---------- tela: fontes ----------

// Um capítulo inteiro tem muito mais que isso; texto curto costuma ser seção fechada no site.
const TEXTO_CURTO = 1500;

async function telaFontes() {
  const d = await api("/api/fontes");
  const contar = (n) => `${n.toLocaleString("pt-BR")} caracteres`;

  const titulo = el("input", { type: "text", autocomplete: "off", placeholder: "Ex.: B-lymphoblastic leukaemia/lymphoma" });
  const versao = el("input", { type: "text", autocomplete: "off", placeholder: "Ex.: WHO, 5ª edição" });
  const contador = el("span", { class: "suave pequeno" }, contar(0));
  const texto = el("textarea", {
    rows: 12, placeholder: "Cole aqui o texto do capítulo",
    oninput: () => { contador.textContent = contar(texto.value.trim().length); },
  });
  const salvar = el("button", { class: "primario", onclick: enviar }, "Salvar fonte");

  async function enviar() {
    const n = texto.value.trim().length;
    if (!titulo.value.trim()) {
      toast("Dê um título para a fonte.");
      titulo.focus();
      return;
    }
    if (!n) {
      toast("Cole o texto do capítulo.");
      texto.focus();
      return;
    }
    if (n < TEXTO_CURTO && !confirm(`O texto tem só ${contar(n)}. Todas as seções do capítulo estavam abertas? Salvar mesmo assim?`)) return;
    salvar.disabled = true;
    try {
      const r = await api("/api/fontes", { titulo: titulo.value, versao: versao.value, texto: texto.value });
      await telaFontes();
      toast(`Fonte salva: ${r.titulo}`);
    } catch (erro) {
      toast(`Não deu certo: ${erro.message}`);
      salvar.disabled = false;
    }
  }

  async function remover(f) {
    if (!confirm(`Remover a fonte "${f.titulo}"? O texto colado será apagado.`)) return;
    try {
      await api(`/api/fontes/${encodeURIComponent(f.id)}/remover`, {});
      await telaFontes();
    } catch (erro) {
      toast(`Não deu certo: ${erro.message}`);
    }
  }

  const itens = d.fontes.map((f) => el("div", { class: "item-fonte" },
    el("div", {},
      el("strong", {}, f.titulo),
      f.versao ? el("span", { class: "suave" }, ` · ${f.versao}`) : null,
      el("div", { class: "suave pequeno" }, [
        f.existe ? (f.caracteres !== null ? contar(f.caracteres) : null) : "⚠ arquivo não encontrado",
        `${f.questoes} questão(ões)`,
        f.arquivo,
      ].filter(Boolean).join(" · "))),
    f.removivel ? el("button", { class: "discreto", onclick: () => remover(f) }, "Remover") : null));

  tela(
    cabecalho("Fontes"),
    d.erros.length ? el("section", { class: "cartao aviso" }, el("ul", {}, d.erros.map((e) => el("li", {}, e)))) : null,
    el("section", { class: "cartao" },
      el("h2", {}, "Adicionar capítulo"),
      el("p", { class: "suave pequeno" },
        "No site, abra todas as seções do capítulo, aperte Ctrl+A e Ctrl+C e cole abaixo. Menus e rodapé podem vir junto, não atrapalham."),
      el("label", { class: "campo" }, el("span", {}, "Título"), titulo),
      el("label", { class: "campo" }, el("span", {}, "Edição ou versão (opcional)"), versao),
      el("label", { class: "campo" }, el("span", {}, "Texto"), texto),
      el("div", { class: "linha entre" }, contador, salvar)),
    el("section", { class: "cartao" },
      el("h2", {}, "Fontes cadastradas"),
      itens.length ? itens : el("p", { class: "suave" }, "Nenhuma fonte ainda.")));
}

// ---------- tela: backup do progresso ----------

async function telaBackup() {
  const atual = await api("/api/progresso");
  const aqui = LOCAL ? "neste celular" : "neste computador";
  const arquivo = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: importar });

  async function exportar() {
    const dados = await api("/api/progresso");
    const nome = `flowquiz-progresso-${LOCAL ? "celular" : "pc"}-${new Date().toISOString().slice(0, 10)}.json`;
    const conteudo = JSON.stringify(dados);
    const arquivoGerado = new File([conteudo], nome, { type: "application/json" });
    // No iPhone, o menu Compartilhar deixa salvar em Arquivos, mandar por WhatsApp, e-mail etc.
    if (navigator.canShare?.({ files: [arquivoGerado] })) {
      try {
        await navigator.share({ files: [arquivoGerado], title: "Backup do FlowQuiz" });
      } catch (erro) {
        if (erro.name !== "AbortError") toast(`Não deu certo: ${erro.message}`);
      }
      return;
    }
    const link = el("a", { href: URL.createObjectURL(arquivoGerado), download: nome });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  async function importar() {
    const escolhido = arquivo.files[0];
    arquivo.value = "";
    if (!escolhido) return;
    let dados;
    try {
      dados = JSON.parse(await escolhido.text());
    } catch {
      toast("Esse arquivo não é um backup do FlowQuiz.");
      return;
    }
    try {
      const r = await api("/api/progresso/importar", dados);
      const devolvidas = r.devolvidas
        ? ` ${r.devolvidas} questão(ões) com problema ${LOCAL ? "saíram do quiz" : "voltaram para a revisão"}.` : "";
      toast(`${r.novas} resposta(s) nova(s) importada(s).${devolvidas}`);
      await telaBackup();
    } catch (erro) {
      toast(`Não deu certo: ${erro.message}`);
    }
  }

  tela(
    cabecalho("Backup do progresso"),
    el("section", { class: "cartao" },
      el("p", {}, `${atual.tentativas.length.toLocaleString("pt-BR")} resposta(s) guardada(s) ${aqui}.`,
        atual.problemas.length ? ` ${atual.problemas.length} questão(ões) marcada(s) com problema.` : null),
      el("h2", {}, "Exportar"),
      el("p", { class: "suave pequeno" }, LOCAL
        ? "Gera um arquivo com todas as suas respostas. Guarde em Arquivos/iCloud ou mande para o PC. Faça de vez em quando: se o app for apagado, o progresso vai junto."
        : "Gera um arquivo com todas as suas respostas, para levar ao celular ou guardar."),
      el("button", { class: "primario", onclick: () => exportar().catch((erro) => toast(`Não deu certo: ${erro.message}`)) }, "Exportar progresso")),
    el("section", { class: "cartao" },
      el("h2", {}, "Importar"),
      el("p", { class: "suave pequeno" },
        "Junta as respostas de um arquivo exportado (do celular ou do PC) com as daqui. Nada se perde nem se repete: importar o mesmo arquivo duas vezes não muda nada."),
      arquivo,
      el("button", { onclick: () => arquivo.click() }, "Escolher arquivo…")));
}

// ---------- versão de celular: senha e instalação ----------

function noIphone() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function dicaInstalar() {
  if (!LOCAL || !noIphone() || navigator.standalone) return null;
  return el("section", { class: "cartao aviso" },
    el("h2", {}, "Instale no iPhone"),
    el("p", {}, "No Safari, toque em Compartilhar (o quadrado com a seta para cima) e depois em \"Adicionar à Tela de Início\"."),
    el("p", { class: "pequeno" }, "Depois abra sempre pelo ícone novo: é ele que funciona sem internet e guarda o seu progresso. O app instalado não enxerga o que foi feito aqui no Safari."));
}

function telaSenha(mensagem) {
  const campo = el("input", {
    type: "password", autocomplete: "current-password", autocapitalize: "none", spellcheck: "false",
    placeholder: "Senha", "aria-label": "Senha",
  });
  const botao = el("button", { class: "primario", type: "submit" }, "Entrar");
  const situacao = el("p", { class: "pequeno", role: "status" }, mensagem || "");

  async function entrar(e) {
    e.preventDefault();
    if (!campo.value.trim()) return;
    botao.disabled = true;
    situacao.textContent = "Abrindo as questões…";
    try {
      await LOCAL.desbloquear(campo.value.trim());
      await rotear();
    } catch (erro) {
      situacao.textContent = erro.message;
      botao.disabled = false;
      campo.select();
    }
  }

  tela(
    el("h1", {}, "FlowQuiz"),
    dicaInstalar(),
    el("form", { class: "cartao", onsubmit: entrar },
      el("h2", {}, "Digite a senha"),
      el("p", { class: "suave pequeno" }, "Só na primeira vez neste aparelho. Depois ele abre direto, mesmo sem internet."),
      el("label", { class: "campo" }, campo),
      el("div", { class: "linha" }, botao),
      situacao));
  if (!noIphone()) campo.focus();
}

// ---------- navegação ----------

let aoSair = null;

function mostrarErro(erro) {
  if (erro.codigo === "senha") {
    telaSenha(erro.message);
    return;
  }
  tela(el("section", { class: "cartao aviso" },
    el("h2", {}, "Algo deu errado"),
    el("p", {}, erro.message),
    LOCAL ? null : el("p", {}, "O servidor (python -m flowquiz servir) está rodando?"),
    el("button", { onclick: rotear }, "Tentar de novo")));
}

async function rotear() {
  aoSair?.();
  aoSair = null;
  atalhos = null;
  const [rota, consulta] = location.hash.slice(1).split("?");
  const params = new URLSearchParams(consulta || "");
  tela(el("p", { class: "carregando" }, "Carregando…"));
  try {
    if (rota === "/estudo") await telaEstudo();
    else if (rota === "/simulado") await telaSimulado(Number(params.get("n")) || 20);
    else if (rota === "/desempenho") await telaDesempenho();
    else if (rota === "/backup") await telaBackup();
    else if (rota === "/revisao" && !LOCAL) await telaRevisao();
    else if (rota === "/fontes" && !LOCAL) await telaFontes();
    else await telaInicio();
  } catch (erro) {
    mostrarErro(erro);
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", rotear);
rotear();
