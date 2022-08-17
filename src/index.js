import { Router } from 'itty-router';

const router = Router();

router
	.get('/profile/:id', async ({ params }) => {
		const { id } = params;

		const profile = await PROFILES.get(id);
		return new Response(profile, {
			headers: { 'content-type': 'application/json' },
			status: profile ? 200 : 404
		  });
	})
	.post('/profile', async (request) => {
		const body = await request.json();

		const walletAddress = body.walletAddress?.trim();
		const walletSignature = body.walletSignature?.trim();

		//TODO validating signature, respond with 401 on failure

		const name = body.name?.trim();
		const email = body.email?.trim();
		const phone = body.phone?.trim();
		const businessName = body.businessName?.trim();

		if (!walletAddress || !walletSignature || !name || !businessName || !(email || phone)) {
			return new Response('Required body parameter is missing or invalid', { status: 400 });
		}

		const digestBuffer = await crypto.subtle.digest(
			{
			  name: 'SHA-256',
			},
			new TextEncoder().encode([walletAddress, name, email, phone, businessName].join(' '))
		  );

		const digest = [...new Uint8Array(digestBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

		const id = crypto.randomUUID();
		PROFILES.put(id, JSON.stringify({ id, name, email, phone, businessName, digest}));

		return new Response(JSON.stringify({ id, digest }), {
			headers: { 'content-type': 'application/json' },
			status: id ? 201 : 400
		  });
	})
	.all('*', async () => new Response(null, { status: 404 }));


addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request).catch((err) => new Response(err.stack, { status: 400 })));
});
