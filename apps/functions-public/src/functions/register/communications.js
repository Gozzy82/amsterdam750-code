export async function sendOtpViaSms(normalizedPhone, formattedCode) {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;
  
  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    throw new Error("Twilio niet geconfigureerd (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER ontbreken)");
  }

  let twilioModule;
  try {
    twilioModule = await import("twilio");
  } catch (err) {
    throw new Error("SMS verzending: kon module 'twilio' niet laden", { cause: err });
  }
  const { default: twilio } = twilioModule;
  const client = twilio(twilioAccountSid, twilioAuthToken);
  await client.messages.create({
    body: `Amsterdam 750: je verificatiecode is ${formattedCode}. Geldig 30 minuten.`,
    from: twilioFromNumber,
    to: normalizedPhone,
  });
}
