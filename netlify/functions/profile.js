const {createClient}=require("@supabase/supabase-js");

const headers={
  "content-type":"application/json",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization,content-type",
  "access-control-allow-methods":"GET,POST,OPTIONS"
};

exports.handler=async(event)=>{
  if(event.httpMethod==="OPTIONS") return {statusCode:204,headers};
  try{
    const token=(event.headers.authorization||"").replace("Bearer ","");
    if(!token) return {statusCode:401,headers,body:JSON.stringify({error:"Unauthorized"})};

    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{
      global:{headers:{Authorization:"Bearer "+token}}
    });
    const {data:{user},error:ue}=await sb.auth.getUser(token);
    if(ue||!user) return {statusCode:401,headers,body:JSON.stringify({error:"Invalid session"})};

    if(event.httpMethod==="GET"){
      const {data,error}=await sb.from("profiles").select("id,name,age,country,gender,level,locked_until,created_at,updated_at").eq("id",user.id).maybeSingle();
      if(data && !data.locked_until && data.updated_at){
        const inferred=new Date(new Date(data.updated_at).getTime()+30*24*60*60*1000);
        data.locked_until=inferred.toISOString();
      }
      return {statusCode:200,headers,body:JSON.stringify(data||{id:user.id})};
    }

    if(event.httpMethod==="POST"){
      const b=JSON.parse(event.body||"{}");
      const name=String(b.name||"").trim();
      const age=Number(b.age);
      const country=String(b.country||"").trim();
      const gender=String(b.gender||"Prefer not to say");

      if(!name||!Number.isInteger(age)||age<13||age>100||!country||!gender){
        return {statusCode:400,headers,body:JSON.stringify({error:"Please complete the required profile fields."})};
      }

      const {data:existing,error:existingError}=await sb.from("profiles")
        .select("id,locked_until,updated_at")
        .eq("id",user.id).maybeSingle();
      if(existingError) throw existingError;

      const now=new Date();
      const effectiveLockedUntil=existing?.locked_until
        ? new Date(existing.locked_until)
        : (existing?.updated_at ? new Date(new Date(existing.updated_at).getTime()+30*24*60*60*1000) : null);
      if(effectiveLockedUntil && effectiveLockedUntil>now){
        const unlockAt=effectiveLockedUntil;
        return {
          statusCode:423,
          headers,
          body:JSON.stringify({
            error:"Your profile is locked for 30 days after saving.",
            locked_until:unlockAt.toISOString()
          })
        };
      }

      const lockedUntil=new Date(now.getTime()+30*24*60*60*1000).toISOString();
      const {data,error}=await sb.from("profiles").upsert({
        id:user.id,name,age,country,gender,
        updated_at:now.toISOString(),
        locked_until:lockedUntil
      }).select("id,name,age,country,gender,level,locked_until,created_at,updated_at").single();

      if(error) throw error;
      return {statusCode:200,headers,body:JSON.stringify(data)};
    }

    return {statusCode:405,headers,body:JSON.stringify({error:"Method not allowed"})};
  }catch(e){
    return {statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};