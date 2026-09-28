importScripts('shared/runtime.js', 'shared/remote-content.js', 'shared/config-handler.js');

DownloaderKit.attachConfigHandler(null, {
  configUrl: '{{CONFIG_URL}}',
  messageType: '{{MESSAGE_PREFIX}}_FETCH_JSON'
});
