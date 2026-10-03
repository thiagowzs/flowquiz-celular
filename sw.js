// Guarda o app inteiro no aparelho para funcionar sem internet.
// Cada versão nova tem outro nome de cache; o navegador troca este arquivo
// sozinho quando ele muda, e a versão nova vale a partir da próxima abertura.
const VERSAO = "flowquiz-7eb3e54f2396";
const ARQUIVOS = ["./", "index.html", "app.js", "config.js", "dados.bin", "icone-180.png", "icone-192.png", "icone-512.png", "local.js", "manifest.webmanifest", "style.css"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(ARQUIVOS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    caches.match(evento.request, { ignoreSearch: true }).then((guardado) => guardado || fetch(evento.request)));
});
