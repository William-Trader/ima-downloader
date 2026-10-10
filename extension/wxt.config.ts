import { defineConfig } from 'wxt';

/**
 * 逆向重建：命名 / 权限 / content_scripts / CSP / key 全部与构建产物 manifest.json 逐字对齐。
 * 注意：manifest.key 为固定扩展 ID 所需，来源于原产物，保留原值。
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ima 下载器',
    description: 'ima 知识库批量下载 · 官方接口直连 · 深色简约版',
    version: '2.1.0',
    action: { default_title: 'ima 导出助手' },
    permissions: [
      'activeTab',
      'downloads',
      'downloads.open',
      'storage',
      'scripting',
      'offscreen',
      'declarativeNetRequest',
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxWXOHUkWvzpHzeKOVi4LsLhCOPnqhj4MTf+HyLdAxktuThYZ39KulZchM3ibN1y3yq+763L7bdFPAEL0/Vx5YSLdgveEFGPV6YBEUn0sdduW/A7wMGchNHruJDYK4+YQ2VSoyLZ2Yw6JRqJmJCtP8Pwg22cwOwp07f9a8UKY+j1mgHN5UYDXBCsA4MTAARLGZOCKIkdMs1OFjHPp+e6Q9dLDMciTIF//d21BidwO0Ty6e+nghNJfInRXay7pI9gotXkHPiSq7Mkvj2vhcFtjBcWLEpFWIRJdGCQIdTxnZsr+7xoxMND2ytiiFB2ZTJDsVAPEi10nzGmU/tNHNNJNpwIDAQAB',
  },
  hooks: {
    /**
     * 产物 manifest 后处理：把 icons / content_scripts 校正回原产物逐字一致
     * （WXT 会自动补 96px 图标、并把 MAIN world 脚本输出到根级且顺序不同）。
     */
    'build:manifestGenerated': (_wxt, manifest) => {
      manifest.icons = {
        '16': 'icons/16.png',
        '32': 'icons/32.png',
        '48': 'icons/48.png',
        '128': 'icons/128.png',
      };
      manifest.content_scripts = [
        {
          matches: ['*://ima.qq.com/*'],
          js: ['content-scripts/content.js'],
        },
        {
          matches: ['https://*.ima.qq.com/*', 'https://ima.qq.com/*'],
          run_at: 'document_start',
          js: ['content-scripts/ima-version-probe.js'],
          world: 'MAIN',
        },
      ] as any;
      delete (manifest as any).web_accessible_resources;
    },
  },
});
