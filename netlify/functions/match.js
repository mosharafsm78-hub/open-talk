const {createClient}=require("@supabase/supabase-js");
const crypto=require("crypto");

const json=(status,body)=>({
  statusCode:status,
  headers:{
    "content-type":"application/json",
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"authorization,content-type",
    "access-control-allow-methods":"POST,OPTIONS"
  },
  body:JSON.stringify(body)
});

exports.handler=async(e)=>{
  if(e.httpMethod==="OPTIONS") return json(204,{});
  if(e.httpMethod!=="POST") return json(405,{error:"Method not allowed"});

  try{
    const token=(e.headers.authorization||"").replace("Bearer ","");
    if(!token) return json(401,{error:"Unauthorized"});

    const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{
      global:{headers:{Authorization:"Bearer "+token}}
    });
    const {data:{user},error:ue}=await sb.auth.getUser(token);
    if(ue||!user) return json(401,{error:"Invalid session"});

    const b=JSON.parse(e.body||"{}");
    const {data:me,error:meError}=await sb.from("profiles")
      .select("id,name,age,country,gender,level").eq("id",user.id).maybeSingle();
    if(meError) throw meError;
    if(!me) return json(409,{error:"Complete your profile before finding a person."});

    const {data:candidates,error}=await sb.from("profiles")
      .select("id,name,age,country,gender,level")
      .neq("id",user.id)
      .limit(50);
    if(error) throw error;

    const blocked=b.blocked_ids||[];
    let pool=(candidates||[]).filter(x=>!blocked.includes(x.id));

    pool.sort((a,b)=>{
      const levelA=a.level===me.level?0:1;
      const levelB=b.level===me.level?0:1;
      const countryA=a.country===me.country?0:1;
      const countryB=b.country===me.country?0:1;
      return (levelA-levelB)||(countryA-countryB);
    });

    const candidate=pool[0]||null;
    if(!candidate) return json(200,{candidate:null});

    const pair=[user.id,candidate.id].sort();
    const bucket=Math.floor(Date.now()/300000);
    const session_id=crypto.createHash("sha256").update(pair.join(":")+":"+bucket).digest("hex").slice(0,32);

    return json(200,{
      candidate:{
        id:candidate.id,
        name:candidate.name,
        age:candidate.age,
        country:candidate.country,
        gender:candidate.gender,
        level:candidate.level
      },
      session_id
    });
  }catch(err){
    return json(500,{error:err.message});
  }
};