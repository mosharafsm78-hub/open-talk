package com.opentalk.app;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Voice-call audio: foreground microphone service, call audio mode, speaker/earpiece. */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private AudioFocusRequest focusRequest;
    private int previousMode = AudioManager.MODE_NORMAL;

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent svc = new Intent(ctx, CallService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc); else ctx.startService(svc);
            AudioManager a = am();
            previousMode = a.getMode();
            a.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= 26) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .build();
                a.requestAudioFocus(focusRequest);
            }
            a.setSpeakerphoneOn(call.getBoolean("speaker", true));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        am().setSpeakerphoneOn(call.getBoolean("on", true));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            release();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void release() {
        AudioManager a = am();
        a.setSpeakerphoneOn(false);
        if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) a.abandonAudioFocusRequest(focusRequest);
        focusRequest = null;
        a.setMode(previousMode);
        getContext().stopService(new Intent(getContext(), CallService.class));
    }

    @Override
    protected void handleOnDestroy() {
        try { release(); } catch (Exception ignored) {}
    }
}
