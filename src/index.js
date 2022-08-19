import { Router } from 'itty-router';
import { recoverPersonalSignature } from '@metamask/eth-sig-util';

const router = Router();

router
	.options('/profile/:id', corsResponse)
	.get('/profile/:id', async ({ params }, env) => {
		const { id } = params;

		const profile = await env.PROFILES.get(id);
		return new Response(profile, {
			headers: { ...getCorsHeaders(env), 'content-type': 'application/json' },
			status: profile ? 200 : 404,
		});
	})
	.options('/profile', corsResponse)
	.post('/profile', async (request, env) => {
		const body = await request.json();

		const walletAddress = body.walletAddress?.trim();
		const walletSignature = body.walletSignature?.trim();

		const name = body.name?.trim();
		const email = body.email?.trim();
		const phone = body.phone?.trim();
		const businessName = body.businessName?.trim();

		if (
			!walletAddress ||
			!walletSignature ||
			!name ||
			!businessName ||
			!(email || phone)
		) {
			return new Response('Required body parameter is missing or invalid', {
				headers: getCorsHeaders(env),
				status: 400,
			});
		}

		const signedMsg = createHexMsg(name, businessName, phone, email);

		const signerAddress = recoverPersonalSignature({
			data: signedMsg,
			signature: walletSignature,
		});

		if (walletAddress !== signerAddress) {
			return new Response(null, { headers: getCorsHeaders(env), status: 401 });
		}

		const digestBuffer = await crypto.subtle.digest(
			{ name: 'SHA-256' },
			new TextEncoder().encode(
				[walletAddress, name, email, phone, businessName].join(' ')
			)
		);

		const digest = [...new Uint8Array(digestBuffer)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const id = crypto.randomUUID();
		env.PROFILES.put(
			id,
			JSON.stringify({ id, name, email, phone, businessName, digest })
		);

		return new Response(JSON.stringify({ id, digest }), {
			headers: { ...getCorsHeaders(env), 'content-type': 'application/json' },
			status: id ? 201 : 400,
		});
	})
	.all('*', async () => new Response(null, { status: 404 }));

export default {
	async fetch(request, env) {
		try {
			return router.handle(request, env);
		} catch (error) {
			return new Response(error.stack, { status: 400 });
		}
	},
};

function createHexMsg(name, businessName, phone, email) {
	const msg = `My name is ${name}. My business name is ${businessName}. My phone is ${phone}. My email is ${email}.`;
	return `0x${Buffer.from(msg, 'utf8').toString('hex')}`;
}

function corsResponse(_request, env) {
	return new Response('', { headers: getCorsHeaders(env), status: 200 });
}

function getCorsHeaders(env) {
	return {
		'Access-Control-Allow-Origin':
			env.WORKER_ENV === 'development' ? '*' : 'https://saplingteam.github.io',
		'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
		'Access-Control-Max-Age': '86400',
		'Access-Control-Allow-Headers': '*',
	};
}
