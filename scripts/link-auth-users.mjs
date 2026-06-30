const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TEMP_PASSWORD) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TEMP_PASSWORD are required.");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json"
};

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = typeof data === "object" ? JSON.stringify(data) : text;
    throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${message}`);
  }
  return data;
}

const users = await request('/rest/v1/User?select=id,email,name,role,status,authUserId');

for (const user of users) {
  if (user.authUserId) {
    console.log(`Already linked: ${user.email}`);
    continue;
  }

  let authUser;
  try {
    authUser = await request('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        password: TEMP_PASSWORD,
        email_confirm: true,
        user_metadata: {
          name: user.name,
          role: user.role,
          app_user_id: user.id
        }
      })
    });
    console.log(`Created auth user: ${user.email}`);
  } catch (error) {
    const listed = await request(`/auth/v1/admin/users?page=1&per_page=100`);
    authUser = listed.users?.find((item) => item.email?.toLowerCase() === user.email.toLowerCase());
    if (!authUser) throw error;
    console.log(`Found existing auth user: ${user.email}`);
  }

  await request(`/rest/v1/User?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ authUserId: authUser.id })
  });
  console.log(`Linked ${user.email} -> ${authUser.id}`);
}
