const {contextBridge}=require('electron');

contextBridge.exposeInMainWorld('openTalkDesktop',{
  platform:'windows',
  version:'0.1.0',
  isDesktop:true
});
