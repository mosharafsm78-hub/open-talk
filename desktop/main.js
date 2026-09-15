const {app,BrowserWindow,session,shell}=require('electron');
const path=require('path');

const APP_URL=process.env.OPEN_TALK_URL||'https://open-talk.netlify.app';

function createWindow(){
  const win=new BrowserWindow({
    width:1440,
    height:920,
    minWidth:1024,
    minHeight:700,
    backgroundColor:'#f7f8fc',
    title:'Open Talk',
    autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      sandbox:true,
      nodeIntegration:false
    }
  });

  win.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url)) shell.openExternal(url);
    return {action:'deny'};
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(()=>{
  const ses=session.defaultSession;

  // Open Talk is a voice app: explicitly allow microphone access.
  ses.setPermissionCheckHandler((_webContents,permission)=>permission==='media'||permission==='notifications');
  ses.setPermissionRequestHandler((_webContents,permission,callback)=>{
    callback(permission==='media'||permission==='notifications');
  });

  app.on('activate',()=>{
    if(BrowserWindow.getAllWindows().length===0)createWindow();
  });
  createWindow();
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin')app.quit();
});
