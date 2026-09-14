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
    const requestedGender=b.gender_preference||"any";
    const requestedCountry=b.target_country||"";
    const requestedLevel=b.target_level||"";
    const priority=!!b.priority;

    const {data:me,error:meError}=await sb.from("profiles")
      .select("id,name,age,country,gender,english_level,gender_preference")
      .eq("id",user.id).maybeSingle();
    if(meError) throw meError;
    if(!me) return json(409,{error:"Complete your profile before finding a person."});

    // Server-authoritative candidate filtering. Never trust the browser for eligibility.
    const {data:candidates,error}=await sb.from("profiles")
      .select("id,name,age,country,gender,english_level")
      .neq("id",user.id)
      .limit(100);
    if(error) throw error;

    const {data:blocks,error:blockError}=await sb.from("blocks")
      .select("blocked_user_id").eq("blocker_id",user.id);
    if(blockError && blockError.code!=="42P01") throw blockError;
    const blocked=new Set((blocks||[]).map(x=>x.blocked_user_id));

    const {data:reverseBlocks,error:reverseError}=await sb.from("blocks")
      .select("blocker_id").eq("blocked_user_id",user.id);
    if(reverseError && reverseError.code!=="42P01") throw reverseError;
    for(const x of reverseBlocks||[]) blocked.add(x.blocker_id);

    let pool=(candidates||[]).filter(x=>!blocked.has(x.id));
    if(requestedGender && requestedGender!=="any") pool=pool.filter(x=>x.gender===requestedGender);
    if(requestedCountry) pool=pool.filter(x=>x.country===requestedCountry);
    if(requestedLevel) pool=pool.filter(x=>x.english_level===requestedLevel);

    pool.sort((a,b)=>{
      const levelA=a.english_level===me.english_level?0:1;
      const levelB=b.english_level===me.english_level?0:1;
      const countryA=a.country===me.country?0:1;
      const countryB=b.country===me.country?0:1;
      return (levelA-levelB)||(countryA-countryB);
    });

    const candidate=pool[0]||null;
    if(!candidate) return json(200,{candidate:null});

    const pair=[user.id,candidate.id].sort();
    const bucket=Math.floor(Date.now()/300000);
    const session_id=crypto.createHash("sha256").update(pair.join(":")+":"+bucket).digest("hex").slice(0,32);

    // A preference is a time-limited pass. Existing passes are reused.
    let passType=null;
    let targetValue="";
    let hours=0;
    let baseCost=0;
    const filterCount=[requestedGender!=="any",!!requestedCountry,!!requestedLevel].filter(Boolean).length;
    if(filterCount>=2){
      passType="smart";
      targetValue=requestedGender+"|"+requestedCountry+"|"+requestedLevel;
      hours=24;
      baseCost=8;
    }else if(requestedGender!=="any"){
      passType="gender"; targetValue=requestedGender; hours=12; baseCost=4;
    }else if(requestedCountry){
      passType="country"; targetValue=requestedCountry; hours=12; baseCost=5;
    }else if(requestedLevel){
      passType="level"; targetValue=requestedLevel; hours=12; baseCost=4;
    }
    const now=new Date();
    let active=false;
    if(passType){
      const {data:existingPass}=await sb.from("match_passes")
        .select("id,expires_at").eq("user_id",user.id).eq("pass_type",passType)
        .eq("target_value",targetValue).gt("expires_at",now.toISOString()).limit(1).maybeSingle();
      active=!!existingPass;
    }
    let priorityActive=false;
    if(priority){
      const {data:pp}=await sb.from("match_passes")
        .select("id").eq("user_id",user.id).eq("pass_type","priority")
        .eq("target_value","priority").gt("expires_at",now.toISOString()).limit(1).maybeSingle();
      priorityActive=!!pp;
    }
    const charge=(active?0:baseCost)+(priority && !priorityActive?3:0);
    if(charge>0){
      const {data:spend,error:spendError}=await sb.rpc("spend_coins",{
        p_user_id:user.id,
        p_amount:charge,
        p_kind:"match",
        p_metadata:{pass_type:passType, target_value:targetValue, priority, candidate_id:candidate.id}
      });
      if(spendError) return json(402,{error:"Not enough coins for this match.",required:charge});
      if(spend===false) return json(402,{error:"Not enough coins for this match.",required:charge});
    }
    if(passType && !active){
      await sb.from("match_passes").insert({
        user_id:user.id,pass_type:passType,target_value:targetValue,
        expires_at:new Date(Date.now()+hours*3600000).toISOString()
      });
    }
    if(priority && !priorityActive){
      await sb.from("match_passes").insert({
        user_id:user.id,pass_type:"priority",target_value:"priority",
        expires_at:new Date(Date.now()+12*3600000).toISOString()
      });
    }
    const newBalance=await sb.rpc("available_coins",{p_user_id:user.id});
    return json(200,{
      candidate:{
        id:candidate.id,
        name:candidate.name,
        age:candidate.age,
        country:candidate.country,
        gender:candidate.gender,
        level:candidate.english_level
      },
      session_id,
      coins_charged:charge,
      new_balance:newBalance.error?null:newBalance.data,
      pass_type:passType,
      pass_expires_at:passType&&!active?new Date(Date.now()+hours*3600000).toISOString():null
    });
  }catch(err){
    return json(500,{error:err.message});
  }
};