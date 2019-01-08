const nodemailer = require('nodemailer')

exports.handler = function(context, event, callback) {
    var smtpTransport = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: context.EMAIL_FROM,
            pass: context.EMAIL_PASSWORD,
        }
    })
    smtpTransport.sendMail({
        from: '"SMS - ' + event.To +'" <' + context.EMAIL_FROM + '>',
        to: context.EMAIL_TO,
        replyTo: event.From + '-'+ context.EMAIL_KEY + '@' + context.EMAIL_REPLY_TO_DOMAIN,
        subject: '[SMS] Message from ' + event.From,
        text: event.Body,
    }, function(err, info) {
        if (err) {
            return callback(err);
        }
        callback(null, new Twilio.twiml.MessagingResponse());
    });
}
