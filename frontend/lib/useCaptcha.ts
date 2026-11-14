import { useCallback, useEffect, useState } from 'react';
import { generateCaptcha } from '../services/api';

/** 图形验证码状态：sessionId 每次刷新都换新，避免旧 session 残留失败计数。 */
export function useCaptcha(autoLoad = false) {
  const [sessionId, setSessionId] = useState(() => newSessionId());
  const [image, setImage] = useState('');
  const [code, setCode] = useState('');
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const id = newSessionId();
    setSessionId(id);
    setCode('');
    setLoading(true);
    setFailed(false);
    try {
      const res = await generateCaptcha(id);
      if (res.success && res.captcha_image) {
        setImage(res.captcha_image);
      } else {
        setImage('');
        setFailed(true);
      }
    } catch {
      setImage('');
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { sessionId, image, code, setCode, required, setRequired, refresh, loading, failed };
}

function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
