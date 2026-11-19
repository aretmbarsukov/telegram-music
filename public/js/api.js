export function createApiClient({ telegram, localApi, getHealth, setConnection }) {
  return async function apiRequest(path, options = {}) {
    const health = await getHealth();
    if (!health) throw new Error("Сесію API не авторизовано");
    const headers = {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    if (telegram?.initData) headers.Authorization = `tma ${telegram.initData}`;
    else if (localApi && health.devAuthEnabled) headers["x-dev-user-id"] = health.devAuthUserId;
    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      setConnection?.("Не вдалося з’єднатися з API. Перевір сервер і базу даних.", "error");
      throw new Error("Сервер недоступний");
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status >= 500) {
        setConnection?.(data?.error || `Помилка API ${response.status}`, "error");
      }
      throw new Error(data?.error || `Помилка API ${response.status}`);
    }
    return data;
  };
}
