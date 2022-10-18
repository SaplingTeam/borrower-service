import { Router } from 'itty-router';
import { Interface } from '@ethersproject/abi';
import { recoverPersonalSignature } from '@metamask/eth-sig-util';

const router = Router();

router
	.options('/profile/:id', corsResponse)
	.get('/profile/:id', async ({ params, query }, env) => {
		const { id } = params;

		const { time, signature, poolAddress } = query || {};

		const profile = await env.PROFILES.get(id);
		if (!signature || !time) {
			const profileObject = JSON.parse(profile);
			return new Response(
				JSON.stringify({
					name: profileObject.name,
					businessName: profileObject.businessName,
					isLocalCurrencyLoan: profileObject.isLocalCurrencyLoan,
					localDetail: profileObject.localDetail ?? {},
				}),
				{
					headers: {
						...getCorsHeaders(env),
						'content-type': 'application/json',
					},
					status: 200,
				}
			);
		}

		const oneDay = 24 * 60 * 60 * 1000;
		const timeObject = new Date(time);
		if (Date.now() - timeObject.getTime() > oneDay) {
			return new Response(null, { headers: getCorsHeaders(env), status: 401 });
		}

		const signerAddress = recoverPersonalSignature({
			data: createLoginMessage(timeObject),
			signature,
		});
		if (signerAddress !== profile.walletAddress) {
			if (poolAddress) {
				const iface = new Interface([
					'function manager() view returns (address)',
				]);
				const response = await fetch(env.RPC_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'eth_call',
						params: [
							{ to: poolAddress, data: iface.encodeFunctionData('manager') },
							'latest',
						],
					}),
				});

				const { result, error } = await response.json();

				if (error) {
					console.error(error);

					return new Response(null, {
						headers: getCorsHeaders(env),
						status: 500,
					});
				}

				const manager = `0x${result.substr(26)}`;
				if (signerAddress !== manager) {
					return new Response(null, {
						headers: getCorsHeaders(env),
						status: 401,
					});
				}
			} else {
				return new Response(null, {
					headers: getCorsHeaders(env),
					status: 401,
				});
			}
		}

		return new Response(profile, {
			headers: { ...getCorsHeaders(env), 'content-type': 'application/json' },
			status: profile ? 200 : 404,
		});
	})
	.patch('/profile/:id', async (request, env) => {
		const body = await request.json();
		const { params, query } = request;
		const { id } = params;

		const { time, signature, poolAddress } = query || {};

		if (
			!time ||
			!signature ||
			!poolAddress
		) {
			return new Response(null, {
				headers: getCorsHeaders(env),
				status: 401,
			});
		}

		const oneDay = 24 * 60 * 60 * 1000;
		const timeObject = new Date(time);
		if (Date.now() - timeObject.getTime() > oneDay) {
			return new Response(null, { headers: getCorsHeaders(env), status: 401 });
		}

		const signerAddress = recoverPersonalSignature({
			data: createLoginMessage(timeObject),
			signature,
		});

		const iface = new Interface([
			'function manager() view returns (address)',
		]);
		const response = await fetch(env.RPC_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'eth_call',
				params: [
					{ to: poolAddress, data: iface.encodeFunctionData('manager') },
					'latest',
				],
			}),
		});

		const { result, error } = await response.json();

		if (error) {
			console.error(error);

			return new Response(null, {
				headers: getCorsHeaders(env),
				status: 500,
			});
		}

		const manager = `0x${result.substr(26)}`;
		if (signerAddress !== manager) {
			return new Response(null, {
				headers: getCorsHeaders(env),
				status: 401,
			});
		}

		const newLocalDetail = body.localDetail;

		if (
			!newLocalDetail.localLoanAmount ||
			!newLocalDetail.localCurrencyCode ||
			!newLocalDetail.fxRate ||
			!newLocalDetail.localInstallmentAmount
		) {
			return new Response('Required body parameter is missing or invalid', {
				headers: getCorsHeaders(env),
				status: 400,
			});
		}

		let profile = JSON.parse(await env.PROFILES.get(id));
		profile.localDetail = newLocalDetail;

		await env.PROFILES.put(
			profile.id,
			JSON.stringify(profile)
		);

		return new Response(null, {
			headers: { ...getCorsHeaders(env), 'content-type': 'application/json' },
			status: 201,
		});
	})
	.options('/profile', corsResponse)
	.post('/profile', async (request, env) => {
		const body = await request.json();

		const walletAddress = body.walletAddress?.trim();
		const walletSignature = body.walletSignature?.trim();
		const poolAddress = body.poolAddress?.trim();

		const name = body.name?.trim();
		const email = body.email?.trim();
		const phone = body.phone?.trim();
		const businessName = body.businessName?.trim();
		const isLocalCurrencyLoan = body.isLocalCurrencyLoan;
		let localDetail = null;

		if (isLocalCurrencyLoan) {
			const localLoanAmount = body.localDetail.localLoanAmount.trim();
			const localCurrencyCode = body.localDetail.localCurrencyCode.trim();
			const fxRate = body.localDetail.fxRate;
			const localInstallmentAmount = "0";

			localDetail = {
				localLoanAmount,
				localCurrencyCode,
				fxRate,
				localInstallmentAmount
			}
		}

		if (
			!walletAddress ||
			!walletSignature ||
			!poolAddress ||
			!name ||
			!businessName ||
			!(email || phone) ||
			isLocalCurrencyLoan && !localDetail
		) {
			return new Response('Required body parameter is missing or invalid', {
				headers: getCorsHeaders(env),
				status: 400,
			});
		}

		const signedMsg = createStoreMessage(name, businessName, phone, email);

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
		await env.PROFILES.put(
			id,
			JSON.stringify({
				id,
				name,
				email,
				phone,
				businessName,
				digest,
				poolAddress,
				walletAddress,
				isLocalCurrencyLoan,
				localDetail,
			})
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

function createLoginMessage(time) {
	return createHexMessage(`Authorization ${time.toISOString()}`);
}

function createStoreMessage(name, businessName, phone, email) {
	return createHexMessage(
		`My name is ${name}.\nMy business name is ${businessName}.${
			phone ? `\nMy phone is ${phone}.` : ''
		}${email ? `\nMy email is ${email}.` : ''}`
	);
}

function createHexMessage(message) {
	return `0x${Buffer.from(message, 'utf8').toString('hex')}`;
}

function corsResponse(_request, env) {
	return new Response('', { headers: getCorsHeaders(env), status: 200 });
}

function getCorsHeaders(env) {
	return {
		'Access-Control-Allow-Origin': env.ORIGIN,
		'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,OPTIONS',
		'Access-Control-Max-Age': '86400',
		'Access-Control-Allow-Headers': '*',
	};
}
