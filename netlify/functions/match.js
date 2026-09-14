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

    // The database function is the single source of truth for the live queue.
    // It atomically claims a waiting human, creates the call, and only charges
    // a paid preference when an actual partner is found.
    const {data:result,error:matchError}=await sb.rpc("find_and_claim_match_v2",{
      p_user_id:user.id,
      p_target_country:requestedCountry,
      p_target_level:requestedLevel,
      p_gender_preference:requestedGender,
      p_priority:priority,
      p_coin_cost:Number(b.coin_cost||0)
    });
    if(matchError){
      const message=String(matchError.message||"Matching failed");
      if(/not enough|insufficient|coins/i.test(message)){
        return json(402,{error:"Not enough coins for this match."});
      }
      throw matchError;
    }
    const row=Array.isArray(result)?result[0]:result;
    if(!row) return json(200,{candidate:null});

    if(!row.partner_id){
      return json(200,{
        candidate:null,
        call_id:null,
        new_balance:row.new_balance,
        coins_charged:Number(row.coins_charged||0),
        pass_type:row.pass_type||null,
        pass_expires_at:row.pass_expires_at||null
      });
    }

    const {data:partner,error:partnerError}=await sb.from("profiles")
      .select("id,name,age,country,gender,english_level")
      .eq("id",row.partner_id).maybeSingle();
    if(partnerError) throw partnerError;
    if(!partner) return json(409,{error:"Your partner profile is unavailable. Please find another person."});

    return json(200,{
      candidate:{
        id:partner.id,
        name:partner.name,
        age:partner.age,
        country:partner.country,
        gender:partner.gender,
        level:partner.english_level
      },
      call_id:row.call_id,
      session_id:row.call_id,
      coins_charged:Number(row.coins_charged||0),
      new_balance:row.new_balance,
      pass_type:row.pass_type||null,
      pass_expires_at:row.pass_expires_at||null
    });
  }catch(err){
    return json(500,{error:err.message});
  }
};