.PHONY: install
install: update

.PHONY: update
update: update-in update-out

.PHONY: update-in
update-in:
	(cd in && npm install)

.PHONY: update-out
update-out:
	(cd out && npm install)

.PHONY: build
build: build-out

.PHONY: build-out
build-out:
	(cd out && zip -r9 lambda.zip index.js node_modules)

.PHONY: clean
clean: clean-in clean-out

.PHONY: clean-in
clean-in:
	rm in/node_modules

.PHONY: clean-out
clean-out:
	rm out/{lambda.zip,node_modules}

.PHONY: deploy
deploy: build upload

.PHONY: deploy-out
deploy-out: build-out upload-out

.PHONY: upload
upload: upload-out

.PHONY: upload-out
upload-out:
	aws --region eu-west-1 lambda update-function-code --function-name arn:aws:lambda:eu-west-1:`aws sts \
	get-caller-identity --query "Account" --output text`:function:email-to-sms --zip-file fileb://out/lambda.zip
