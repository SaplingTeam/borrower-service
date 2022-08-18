import { Router } from 'itty-router';
import { recoverPersonalSignature } from "@metamask/eth-sig-util";

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
		const walletSignature = body.walletSignature?.trim()

		const name = body.name?.trim();
		const email = body.email?.trim();
		const phone = body.phone?.trim();
		const businessName = body.businessName?.trim();

		if (!walletAddress || !walletSignature || !name || !businessName || !(email || phone)) {
			return new Response('Required body parameter is missing or invalid', { status: 400 });
		}

		const signedMsg = createHexMsg(name, businessName, phone, email);
		console.log(signedMsg);

		const signerAddress = recoverPersonalSignature({
			data: signedMsg,
			signature: walletSignature
		  });

		if (walletAddress !== signerAddress) {
			return new Response(null, { status: 401 });
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

function createHexMsg(name, businessName, phone, email) {
	const msg = `My name is ${name}. My business name is ${businessName}. My phone is ${phone}. My email is ${email}.`;
	return `0x${Buffer.from(msg, "utf8").toString("hex")}`;
};
