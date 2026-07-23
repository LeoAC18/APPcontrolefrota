// URL base do servidor backend.
//
// - No NAVEGADOR (site servido pelo próprio backend, ex. mctransportes.up.railway.app
//   ou http://localhost:3000 em dev): usa caminhos RELATIVOS (SERVER_URL vazio),
//   assim o app continua funcionando mesmo se o domínio mudar.
// - No APP INSTALADO (APK/IPA via Capacitor): a página roda em https://localhost /
//   capacitor://localhost, então precisa da URL completa do servidor.
(function () {
  var SERVIDOR_PRODUCAO = 'https://mctransportes.up.railway.app';
  var isCapacitor = location.protocol === 'capacitor:' ||
    (location.hostname === 'localhost' && !location.port);
  window.SERVER_URL = isCapacitor ? SERVIDOR_PRODUCAO : '';
})();
