# Publicar o app MC Check List na Google Play

Guia de ponta a ponta. O projeto usa **Capacitor 6** — a interface (`www/`) é
empacotada dentro do app e chama a **API do Railway em produção**
(`https://mctransportes.up.railway.app`), tratado em `www/config.js`. Ou seja, o
app instalado **funciona online** sem servidor local.

> ⚠️ A pasta `android/` está no `.gitignore` (convenção do Capacitor). As mudanças
> abaixo ficam **locais** na sua máquina. **Não** rode `npx cap add android` de novo
> — isso regenera a pasta e apaga a permissão de câmera e a config de assinatura.

---

## O que já foi preparado
- ✅ Interface atualizada (as 6 features de hoje) copiada para o app: `npx cap copy android`.
- ✅ Permissão de **câmera** adicionada em `android/app/src/main/AndroidManifest.xml`.
- ✅ Bloco de **assinatura de release** em `android/app/build.gradle`, lendo de
  `android/keystore.properties` (sem senha no código).
- ✅ Modelo `android/keystore.properties.example`.

---

## Fase 1 — Gerar um APK para TESTAR hoje (SDK 34, baixo risco)

### 1.1 Criar a chave de assinatura (uma única vez)
Na pasta `android/`, rode (o `keytool` vem com o Java):

```bash
keytool -genkey -v -keystore mc-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mc-upload
```

Ele pede uma senha e alguns dados (nome, organização, etc.). **Guarde o arquivo
`mc-release.jks` e as senhas em local MUITO seguro** — se perder, você não consegue
mais atualizar o app na Play.

### 1.2 Criar o `keystore.properties`
Copie `android/keystore.properties.example` para `android/keystore.properties` e
preencha com as senhas que você definiu:

```
storeFile=mc-release.jks
storePassword=...
keyAlias=mc-upload
keyPassword=...
```

### 1.3 Abrir no Android Studio e gerar o APK
1. Abra o Android Studio → **Open** → selecione a pasta `android/`.
2. Espere o Gradle sincronizar (usa o **JDK 17 embutido** do Android Studio).
3. Para um APK de teste rápido: **Build → Build Bundle(s)/APK(s) → Build APK(s)**.
   - O APK sai em `android/app/build/outputs/apk/`.
4. Instale nos celulares dos motoristas (ative "Fontes desconhecidas" / instale via cabo).

### 1.4 Testar no aparelho — o mais importante
- Login do motorista, criar um Check List, **tirar as fotos dos lacres** (valida a
  câmera + permissão), registrar parada, enviar. Confirmar que chega no painel do gestor.
- Se a câmera não abrir, me avise — pode precisar de ajuste no plugin/manifesto.

---

## Fase 2 — Preparar para a Play (bump para targetSdk 35)

A Play **exige targetSdk 35** para apps novos. Faça estas edições e sincronize no
Android Studio (ele baixa a versão nova do Gradle/AGP automaticamente):

1. `android/variables.gradle`: `compileSdkVersion = 35` e `targetSdkVersion = 35`.
2. `android/build.gradle`: `classpath 'com.android.tools.build:gradle:8.7.2'`.
3. `android/gradle/wrapper/gradle-wrapper.properties`:
   `distributionUrl=https\://services.gradle.org/distributions/gradle-8.9-all.zip`.
4. (Opcional) subir `versionName` para algo como `"1.0"` e manter `versionCode 1`
   no primeiro envio (`android/app/build.gradle`).

> Se o Android Studio reclamar de incompatibilidade de versões, me chame que ajusto
> os números — essa combinação (AGP 8.7 + Gradle 8.9 + SDK 35) é a testada.

### 2.1 Gerar o AAB assinado (formato obrigatório da Play)
No Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**,
selecione o `mc-release.jks` e as senhas. O `.aab` sai em
`android/app/build/outputs/bundle/release/`.

---

## Fase 3 — Google Play Console

### 3.1 Criar a conta de desenvolvedor
- Acesse **play.google.com/console**, pague a taxa **única de US$ 25**.
- **Recomendado: abrir como conta de ORGANIZAÇÃO (empresa MC Transportes)**, não
  pessoal. Motivo abaixo. Precisa de verificação de identidade (e, para empresa, um
  número D-U-N-S — a obtenção é gratuita e leva alguns dias).

> ⚠️ **Regra do Google:** contas **pessoais** criadas após nov/2023 precisam rodar um
> **teste fechado com ≥12 testadores por 14 dias seguidos** antes de liberar a
> produção. Contas de **organização não têm essa exigência** — por isso vale abrir
> como empresa.

### 3.2 Criar o app e subir o AAB
1. **Create app** → nome, idioma (Português-BR), tipo App, gratuito.
2. Vá em **Testing → Internal testing** (ou Produção, se conta de organização) →
   **Create release** → faça upload do `.aab`.
3. A Play vai gerenciar a chave de app (**Play App Signing**) — aceite; a `mc-release.jks`
   vira sua chave de **upload**.

### 3.3 Preencher os requisitos obrigatórios
- **Ficha da loja:** descrição curta e completa, ícone 512×512, screenshots do celular.
- **Classificação de conteúdo** (questionário).
- **Política de privacidade (URL)** — precisa de uma página pública. Posso gerar uma
  simples e hospedar no Railway (ex.: `/privacidade`).
- **Segurança dos dados:** declarar que coleta CPF, fotos, localização de texto, etc.
- **Público-alvo** e declaração de apps de trabalho, se aplicável.

### 3.4 Enviar para revisão
- Conta de organização: pode ir direto para **Produção**.
- Conta pessoal: rodar o teste fechado (12 testadores/14 dias) e depois pedir acesso à produção.
- Revisão do Google na 1ª vez: de alguns dias a ~1 semana.

---

## Atualizar o app depois (novas versões)
Sempre que a interface (`www/`) mudar e você quiser atualizar o app instalado:
1. `npx cap copy android` (copia a interface nova).
2. Suba o `versionCode` (+1) e o `versionName` em `android/app/build.gradle`.
3. Gere um novo AAB assinado e suba na Play.

> Lembrando: mudanças que são só de **backend/dados** (API no Railway) aparecem no app
> **sem** republicar — só o que é interface exige nova versão.
