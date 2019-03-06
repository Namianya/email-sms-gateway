// Uploaded by email-sms-gateway project.

const AWS = require('aws-sdk');
const https = require('https')
const mailparser = require('mailparser')
const nodemailer = require('nodemailer')

AWS.config.region = 'eu-west-1';

var s3 = new AWS.S3()
var smtpTransport = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env['EMAIL_REPLY_FROM'],
        pass: process.env['EMAIL_PASSWORD'],
    }
});

const S3Delete = function(bucketName, key, callback) {
    s3.deleteObject({
        Bucket: bucketName,
        Key: key
    }, function (err) {
        if (err) {
            return callback(err)
        }
        console.log('File deleted ' + bucketName + '/' + key)
        return callback(null)
    })
}

const S3Read = function(bucketName, key, callback) {
    s3.getObject({
        Bucket: bucketName,
        Key: key
    }, function(err, data) {
        if (err) {
            return callback(err)
        }
        console.log('File read ' + bucketName + '/' + key)
        return callback(null, data.Body.toString('utf-8'))
    })
}

const S3Lock = function(bucketName, key, callback) {
    s3.headObject({
        Bucket: bucketName,
        Key: key
    }, function(err, data) {
        if (err && err.statusCode !== 404) {
            return callback(err)
        }
        console.log('File locking ' + bucketName + '/' + key)
        if (!err) {
            return callback(null, false)
        }
        s3.putObject({
            Body: '',
            Bucket: bucketName,
            Key: key
        }, function (err, data) {
            if (err) {
                return callback(err)
            }
            callback(null, true)
        })
    })
}

const EmailSend = function(emailTo, emailFrom, emailReplyTo, parentId, referenceIds, subject, message, callback) {
    var options = {
        from: emailFrom,
        to: emailTo,
        replyTo: emailReplyTo,
        subject: subject,
        text: message,
    }
    if (parentId) {
        options['inReplyTo'] = parentId
    }
    if (referenceIds) {
        options['references'] = referenceIds.concat(parentId)
    }
    smtpTransport.sendMail(options, function(err, info) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
}

const SMSSend = function(toNumber, message, callback) {
    var enabled = process.env['SMS_ENABLED'] == "1" || process.env['SMS_ENABLED'] == "true"
    if (enabled) {
        var username = process.env['SMS_USERNAME']
        var password = process.env['SMS_PASSWORD']
        var fromNumber = process.env['SMS_FROM']

        var data = 'From=' + fromNumber + '&To=' + toNumber + '&Body=' + message
        var request = https.request({
            hostname: 'api.twilio.com',
            path: '/2010-04-01/Accounts/' + username + '/Messages.json',
            method: 'POST',
            auth: username + ':' + password,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data)
            }
        }, function(result) {
            result.setEncoding('utf-8')
            result.on('data', function(data) {
                console.log("Result:\n" + data)
            })
            result.on('end', function() {
                return callback(null)
            })
        })
        request.on('error', function(err) {
            return callback(err)
        })
        request.write(data)
        request.end()
    } else {
        return callback(null)
    }
}

const PadNumber = function(number, length) {
    var str = number + "";
    while (str.length < length) {
        str = "0" + str
    }
    return str;
}

const HandleNotification = function(sesNotification, s3Bucket, messageId, callback) {
    var emailId = sesNotification.mail.commonHeaders.messageId.replace(/^<?([^>]+)>?$/, '$1');
    console.log('Email id: ' + emailId);

    S3Lock(s3Bucket,'email-ids/' + emailId, function (err, lock) {
        // If message has been handled then fail.
        if (err) {
            return callback(err)
        }
        if (!lock) {
            return callback('Message has already been handled.')
        }

        S3Read(s3Bucket, 'emails/' + messageId, function(err, content) {
            if (err) {
                return callback(err)
            }
            console.log("Content:\n" + content);
            mailparser.simpleParser(content, function(err, email) {
                if (err) {
                    return callback(err)
                }

                console.log("Email:\n", JSON.stringify(email, null, 2));

                const date = new Date();
                const emailForwardFroms = process.env['EMAIL_FORWARD_FROM'];
                const emailFrom = email.from.value[0].address;
                const emailReplyFrom = process.env['EMAIL_REPLY_FROM'];
                const emailReplyTo = process.env['EMAIL_REPLY_TO'];
                const emailTos = email.to.value.map(function(email) { return email.address });
                const key = process.env['EMAIL_KEY'];
                const messageReplyName = email.from.value[0].name + ' <' + emailFrom + '>';
                const messageReplyDate = 'On ' +
                    PadNumber(date.getUTCDate(), 2) + '/' +
                    PadNumber(date.getUTCMonth(), 2) + '/' +
                    date.getUTCFullYear() + ' ' +
                    PadNumber(date.getUTCHours(), 2) + ':' +
                    PadNumber(date.getUTCMinutes()) + ', ' +
                    (email.from.value[0].name || emailFrom) + ' wrote:';

                const messageFull = email.text;
                console.log("Email text:\n" + messageFull);
                const message = messageFull.split(/On .* wrote/)[0];
                const messageFullQuoted = messageFull.split(/\r\n|\r(?!\n)|(?!<\r)\n/).map(function(line) { return '> ' + line }).join("\r\n");
                let subject = 'Re: ' + email.subject;

                // If message is empty then fail.
                if (!message) {
                    let messageReply = 'Message is empty.';
                    let messageReplyFull = messageReply + "\n\n" + messageReplyDate + "\n" + messageFullQuoted;
                    console.error(messageReply);
                    return EmailSend(
                        emailFrom,
                        emailReplyFrom,
                        emailTos[0],
                        email.messageId,
                        email.references,
                        subject,
                        messageReplyFull,
                        function(err) {
                            if (err) {
                                callback(err)
                            }
                            return callback(messageReply)
                        }
                    )
                }

                console.log("Message:\n" + message);

                // If from address is not recognised then fail.
                if (!emailForwardFroms.includes(emailFrom)) {
                    let messageReply = 'From email is not recognised: ' + emailFrom + '.';
                    let messageReplyFull = messageReply + "\n\n" + messageReplyDate + "\n" + messageFullQuoted;
                    console.error(messageReply);
                    return EmailSend(
                        emailFrom,
                        emailReplyFrom,
                        emailTos[0],
                        email.messageId,
                        email.references,
                        subject,
                        messageReplyFull,
                        function(err) {
                            if (err) {
                                callback(err)
                            }
                            return callback(messageReply)
                        }
                    )
                }

                let numbersTo = [];
                for (let i = 0; i < emailTos.length; i++) {
                    let emailTo = emailTos[i];
                    console.log('To email: ' + emailTo);
                    // If to email does not include email key then skip it.
                    if (!emailTo.includes('-' + key)) {
                        messageReply = 'To email does not include email key.';
                        messageReplyFull = messageReply + "\n\n" + messageReplyDate + "\n" + messageFullQuoted;
                        console.error(messageReply);
                        EmailSend(
                            emailFrom,
                            emailReplyFrom,
                            emailTo,
                            email.messageId,
                            email.references,
                            subject,
                            messageReplyFull,
                            function(err) {
                                if (err) {
                                    callback(err)
                                }
                            }
                        );
                        continue
                    }
                    let numberTo = emailTo.split('-')[0];
                    console.log('To number: ' + numberTo);
                    if (numberTo.match(/^\+?[0-9]+$/)) {
                        numbersTo.push(numberTo.replace(/^0/, '+44'))
                    }
                }

                // If to numbers is empty then fail.
                if (!numbersTo.length) {
                    messageReply = 'To number does not exist.';
                    messageReplyFull = messageReply + "\n\n" + messageReplyDate + messageFullQuoted;
                    console.error(messageReply);
                    return EmailSend(
                        emailFrom,
                        emailReplyFrom,
                        emailTos[0],
                        email.messageId,
                        email.references,
                        subject,
                        messageReplyFull,
                        function(err) {
                            if (err) {
                                callback(err)
                            }
                            return callback(messageReply)
                        }
                    )
                }

                let messageReply = messageReplyName + ' responded to this SMS.';
                let messageReplyFull = messageReply + "\n\n" + messageReplyDate + "\n" + messageFullQuoted;
                console.log('Sending to ' +  emailReplyTo + ":\n" + message);
                EmailSend(
                    emailReplyTo,
                    emailReplyFrom,
                    emailReplyTo,
                    email.messageId,
                    email.references,
                    subject,
                    messageReplyFull,
                    callback,
                );
                for (var i = 0; i < numbersTo.length; i++) {
                    let numberTo = numbersTo[i];
                    console.log('Sending to ' +  numberTo + ":\n" + message);
                    SMSSend(numberTo, message, callback)
                }
            })
        })
    })
}

exports.handler = function(event, context, callback) {
    var sesNotification = event.Records[0].ses;
    var s3Bucket = process.env['S3_BUCKET']
    var messageId = sesNotification.mail.messageId

    console.log("SES notification:\n", JSON.stringify(sesNotification, null, 2));

    HandleNotification(sesNotification, s3Bucket, messageId, function(err) {
        S3Delete(s3Bucket, 'emails/' + messageId, function(err) {
            if (err) {
                return callback(err)
            }
            return callback(null, null)
        })
        if (err) {
            return callback(err)
        }
        return callback(null, null)
    })
};
