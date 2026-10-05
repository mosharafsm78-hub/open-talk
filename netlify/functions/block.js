const{createClient}=require("@supabase/supabase-js");
const j=(s,b)=>({statusCode:s,headers:{"content-type":"application/json"},body:JSON.stringify(b)});

// Blocks a user and ends any live call between the two (done atomically by
// the block_user database function, which uses the caller's own session).
exports.handler=async e=>{
  try{
    const t=(e.headers.authorization||"").replace("Bearer ","");
    if(!t)return j(401,{error:"Unauthorized"});
    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:"Bearer "+t}}});
    const{data:{user}}=await sb.auth.getUser(t);
    if(!user)return j(401,{error:"Unauthorized"});
    const b=JSON.parse(e.body||"{}");
    if(!b.blocked_user_id||b.blocked_user_id===user.id)return j(400,{error:"Invalid blocked_user_id"});
    const{data,error}=await sb.rpc("block_user",{p_blocked_user_id:b.blocked_user_id});
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    return j(201,{blocked:true,calls_ended:row?.calls_ended||0});
  }catch(err){return j(500,{error:err.message})}
};
