const AWS = require('aws-sdk');
const https = require('https')
const mailparser = require('mailparser')

AWS.config.region = 'eu-west-1';

var s3 = new AWS.S3()

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

const SMSSend = function(toNumber, message, callback) {
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
}

const HandleNotification = function(sesNotification, s3Bucket, messageId, callback) {
    var fromEmails = process.env['EMAIL_FROM']
    var fromEmail = sesNotification.mail.source
    var key = process.env['EMAIL_KEY']

    // If from address is not recognised then fail.
    if (! fromEmails.includes(fromEmail)) {
        return callback('From email is not recognised: ' + fromEmail + '.')
    }

    var toEmails = sesNotification.receipt.recipients
    var toNumbers = []
    for (var i = 0; i < toEmails.length; i++) {
        var toEmail = toEmails[i]
        console.log('To email: ' + toEmail)
	    // If to email does not include email key then skip it/
        if (!toEmail.includes('-' + key)) {
            console.error('To email does not include email key.')
            continue
        }
        var toNumber = toEmail.split('-')[0]
        console.log('To number: ' + toNumber)
        if (toNumber.match(/^\+?[0-9]+$/)) {
            toNumbers.push(toNumber.replace(/^0/, '+44'))
        }
    }

    // If to numbers is empty then fail.
    if (!toNumbers.length) {
        return callback('To number does not exist.')
    }

    var emailId = sesNotification.mail.commonHeaders.messageId.replace(/^<?([^>]+)>?$/, '$1')
    console.log('Email id: ' + emailId)
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
            console.log("Content:\n" + content)
            mailparser.simpleParser(content, function(err, email) {
                if (err) {
                    return callback(err)
                }
                var body = email.text
                console.log("Body:\n" + body)
                var message = body.split(/On .* wrote/)[0]
                // If message is empty then fail.
                if (! message) {
                    return callback('Message is empty.');
                }
                console.log("Message:\n" + message)

                for (var i = 0; i < toNumbers.length; i++) {
                    var toNumber = toNumbers[i]
                    console.log('Sending to ' +  toNumber + ":\n" + message)
                    SMSSend(toNumber, message, callback)
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

