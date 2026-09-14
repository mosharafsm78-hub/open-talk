const {createClient}=require("@supabase/supabase-js");

exports.handler=async(event)=>{
  const headers={
    "content-type":"application/json",
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"content-type",
    "access-control-allow-methods":"GET,OPTIONS"
  };
  if(event.httpMethod==="OPTIONS") return {statusCode:204,headers};
  if(event.httpMethod!=="GET") return {statusCode:405,headers,body:JSON.stringify({error:"Method not allowed"})};

  try{
    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY);
    const {data,error}=await sb.auth.signInAnonymously();
    if(error) throw error;
    return {
      statusCode:200,
      headers,
      body:JSON.stringify({
        supabase_url:process.env.SUPABASE_URL,
        session:data.session,
        user:data.user
      })
    };
  }catch(e){
    return {
      statusCode:503,
      headers,
      body:JSON.stringify({
        error:"Anonymous human sessions are not enabled on the connected Supabase project yet.",
        detail:e.message
      })
    };
  }
};