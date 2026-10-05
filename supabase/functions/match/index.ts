import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function json(status:number, body:unknown){
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json(405,{error:"Method not allowed"});

  try{
    const auth=req.headers.get("Authorization")||"";
    const token=auth.replace(/^Bearer\s+/i,"").trim();
    if(!token) return json(401,{error:"Unauthorized"});

    const supabase=createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {global:{headers:{Authorization:"Bearer "+token}}}
    );

    const {data:{user},error:userError}=await supabase.auth.getUser(token);
    if(userError||!user) return json(401,{error:"Invalid session"});

    const body=await req.json().catch(()=>({}));

    const adminKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!adminKey) throw new Error("Matching service is missing its server key.");
    const db=createClient(Deno.env.get("SUPABASE_URL")!,adminKey);

    // Explicit leave: remove the user from the queue and release any
    // pre-connection or active call so the partner can be matched again.
    if(body.action==="leave"){
      await db.from("waiting_users").delete().eq("user_id",user.id);
      await db.from("calls")
        .update({status:"cancelled",ended_at:new Date().toISOString()})
        .in("status",["matched","active"])
        .or("caller_id.eq."+user.id+",receiver_id.eq."+user.id);
      return json(200,{ok:true});
    }

    const gender=body.gender_preference||"any";
    const country=body.target_country||"";
    const level=body.target_level||"";
    const priority=Boolean(body.priority);
    const coinCost=Number(body.coin_cost||0);

    const {data:profile,error:profileError}=await db
      .from("profiles")
      .select("id,name,age,country,gender,english_level")
      .eq("id",user.id)
      .maybeSingle();

    if(profileError) throw profileError;
    const clientProfile=body.profile||{};
    if(!profile){
      const safeProfile={
        id:user.id,
        name:String(clientProfile.name||"").trim(),
        age:Number(clientProfile.age||0),
        country:String(clientProfile.country||"").trim(),
        gender:String(clientProfile.gender||"").trim(),
        english_level:String(clientProfile.english_level||"A1").trim(),
        gender_preference:"any",
        updated_at:new Date().toISOString()
      };
      if(!safeProfile.name||!safeProfile.age||!safeProfile.country||!safeProfile.gender){
        return json(409,{error:"Complete your profile before finding a person.",stage:"PROFILE"});
      }
      const {error:upsertError}=await db.from("profiles").upsert(safeProfile,{onConflict:"id"});
      if(upsertError) throw upsertError;
    }

    const {data:result,error:matchError}=await db.rpc("find_and_claim_match_v2",{
      p_user_id:user.id,
      p_target_country:country,
      p_target_level:level,
      p_gender_preference:gender,
      p_priority:priority,
      p_coin_cost:coinCost
    });

    if(matchError){
      const message=String(matchError.message||"Matching failed");
      if(/not enough|insufficient|coins/i.test(message)) return json(402,{error:"Not enough coins for this match."});
      throw matchError;
    }

    const row=Array.isArray(result)?result[0]:result;
    if(!row) return json(200,{candidate:null,call_id:null,session_id:null});

    if(!row.partner_id){
      return json(200,{
        candidate:null,
        call_id:null,
        session_id:null,
        new_balance:row.new_balance,
        coins_charged:Number(row.coins_charged||0),
        pass_type:row.pass_type||null,
        pass_expires_at:row.pass_expires_at||null
      });
    }

    const {data:partner,error:partnerError}=await db
      .from("profiles")
      .select("id,name,age,country,gender,english_level")
      .eq("id",row.partner_id)
      .maybeSingle();

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
  }catch(error){
    console.error(error);
    return json(500,{error:error instanceof Error?error.message:"Matching service error"});
  }
});