# Email/SMS gateway

Infrastructure to run an Email/SMS gateway.

## Deployment

### Incoming (SMS to email gateway)

Incoming messaging (SMS to email) is be provided by [Twilio] and [Gmail].

Twilio currently supplies their trial account with $15 which can be used for 
over one year of their phone number service ($1/month) and a reasonable number 
of incoming SMS ($0.0075/SMS).

Gmail can send emails for free via an `app password`.

Requirements:

* [Gmail] account
* [Twilio] trial account

Unfortunately [Twilio] does not provide any sort of deployment so the following
steps have to be done manually: 

* Create a new [Google App password]
* Create a new [Twilio Function]: `sms-to-email`
    * Function name: `sms-to-email`
    * Access control: `Check for valid Twilio signature`
    * Event: `Incoming Messages`
    * Code: copy from [in/index.js] 
* Under `Configure` add the following `Environmental Variables`:
    * `EMAIL_FROM`: the sender email address (e.g. `me@gmail.com`) 
    * `EMAIL_KEY`: a key appended to the send email to authorise sending SMS via
    the email to SMS gateway (e.g. `password`) used in the reply to email (e.g. 
    `+4470000123456-password@sms.domain.com`)
    * `EMAIL_PASSWORD`: the Gmail app password 
    * `EMAIL_REPLY_TO_DOMAIN`: the reply to domain used for the email to SMS 
    gateway (e.g. `sms.domain.com`) 
    * `EMAIL_TO`: the recipient email address (e.g. `me@gmail.com`)
* Under `Configure` add the following dependencies:
    * [nodemailer]
* Add an active mobile [Twilio Phone Number]
* Under number management set Messaging > A message comes in to `Function`, 
`sms-to-email` 

### Outgoing (email to SMS gateway)

Outgoing messaging (email to SMS) is provided by [AWS] and [Twilio].

Twilio requires a full account to send SMS messages to any number other than the
verified number.

Requirements:

* [AWS] account
* [Twilio] full account
* Domain name (for incoming email)

Steps:

* Create a new [AWS S3 bucket] blocking public access (replacing 
`your-account-name`): `your-account-name-email-to-sms`
* Add bucket policy (replacing `your-account-id` and `your-account-name`):
    ```json
    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowSESPuts",
                "Effect": "Allow",
                "Principal": {
                    "Service": "ses.amazonaws.com"
                },
                "Action": "s3:PutObject",
                "Resource": "arn:aws:s3:::your-account-name-email-to-sms/*",
                "Condition": {
                    "StringEquals": {
                        "aws:Referer": "your-account-id"
                    }
                }
            }
        ]
    }
    ```
* Add a lifecycle rule:
    * Name: `expire`
    * Expiration: `Current version`
    * Expire current version of object: After `1` days from object creation
    * Clean up incomplete multiplart uploads: After `1` days from start of 
    upload
* Create a new [AWS IAM policy]: 
    * Name (replacing `YourAccountName`): 
    `AmazonS3YourAccountNameEmailToSMSReadWrite`
    * JSON (replacing `your-account-name`): 
        ```json
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "VisualEditor0",
                    "Effect": "Allow",
                    "Action": [
                        "s3:ListAllMyBuckets",
                        "s3:HeadBucket"
                    ],
                    "Resource": "*"
                },
                {
                    "Sid": "VisualEditor1",
                    "Effect": "Allow",
                    "Action": "s3:*",
                    "Resource": [
                        "arn:aws:s3:::your-account-name-email-to-sms/*",
                        "arn:aws:s3:::your-account-name-email-to-sms"
                    ]
                }
            ]
        }
        ```
* Create a new [AWS IAM policy]: 
    * Name: `AWSLambdaBasicExecutionRoleEmailToSMS`
    * JSON (replacing `your-account-id`): 
        ```json
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": "logs:CreateLogGroup",
                    "Resource": "arn:aws:logs:eu-west-1:your-account-id:*"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    "Resource": [
                        "arn:aws:logs:eu-west-1:your-account-id:log-group:/aws/lambda/email-to-sms:*"
                    ]
                }
            ]
        }
        ```
* Create a new [AWS IAM role]:
    * AWS service: `Lambda`
    * Permissions (replacing `YourAccountName`): 
    `AmazonS3YourAccountNameEmailToSMSFullAccess`, 
    `AWSLambdaBasicExecutionRoleEmailToSMS` 
    * Name: `LambdaEmailToSMS`
* Create a new [AWS Lambda function]:
    * Name: `email-to-sms`
    * Runtime: `Node.js 8.*`
    * Role: `Choose an existing role`
    * Existing role: `LambdaEmailToSMS`
* Create an [AWS SES domain] and verify your domain name
* Add an [AWS SES recipient ruleset]
* Create an AWS SES recipient rule:
    * Recipient: domain e.g. `sms.domain.com`
    * Action: `S3`:
        * S3 bucket (replacing `your-account-name`): 
        `your-account-name-email-to-sms`
        * Object key prefix: `emails`
    * Action: `Lambda`:
        * Lambda function: `email-to-sms`
        * Invocation type: `Event`
    * Action: `Stop Rule Set`:
        * S3 bucket (replacing `your-account-name`): 
        `your-account-name-email-to-sms`
        * Object key prefix: `emails`
    * Name: `email-to-sms`
    * Require-TLS: Ticked
* Add the environmental variables:
    * `EMAIL_FROM`: a semicolon separated list of emails authorised to send 
   SMSes (e.g. `me@gmail.com;me@hotmail.com`)
    * `EMAIL_KEY`: a key appended to the send email to authorise sending SMSes 
    (e.g. `password` used in the To email like
    `+4470000123456-password@sms.domain.com`)
    * `S3_BUCKET`: the S3 bucket storing to store incoming emails and email-ids
    (e.g. `email-to-sms`) 
    * `SMS_FROM`: the Twilio sender number (e.g `+44070000123456`)   
    * `SMS_PASSWORD`: the Twilio Auth Token
    * `SMS_USERNAME`: the Twilio Account SID 
* Deploy the [AWS Lambda function]:
    ```bash
    # Optionally specify AWS credentials.
    AWS_ACCESS_KEY_ID=
    AWS_SECRET_ACCESS_KEY=
    # Deploy.
    make deploy-out
    ```
    
[AWS]: https://aws.amazon.com
[AWS IAM policy]: https://console.aws.amazon.com/iam/home#/policies
[AWS IAM role]: https://console.aws.amazon.com/iam/home#/roles
[AWS Lambda function]: https://console.aws.amazon.com/lambda/home#/functions
[AWS S3 bucket]: https://s3.console.aws.amazon.com/s3/home
[AWS SES domain]: https://console.aws.amazon.com/ses/home#verified-senders-domain:
[AWS SES recipient ruleset]: https://console.aws.amazon.com/ses/home#receipt-rules:
[Gmail]: https://mail.google.com/mail
[Google App password]: https://myaccount.google.com/apppasswords
[in/index.js]: in/index.js
[nodemailer]: https://www.npmjs.com/package/nodemailer
[Twilio]: https://www.twilio.com
[Twilio Function]: https://www.twilio.com/console/runtime/functions/manage
[Twilio Phone Number]: https://www.twilio.com/console/phone-numbers/incoming
