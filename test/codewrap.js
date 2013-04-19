
const PATH = require("path");
const ASSERT = require("assert");
const WAITFOR = require("waitfor");
const GLOB = require("glob");
const FS = require("fs-extra");
const CODEWRAP = require("../lib/codewrap");

const MODE = "test";
const MODE = "write";


describe('codewrap', function() {

	it('should export `parseFile()`', function() {
		ASSERT(typeof CODEWRAP.parseFile === "function");
	});

	describe('`parseFile()`', function() {

		it('should wrap various', function() {

			function getFiles(callback) {
				var rules = [
					"umd/*.js",
					"various/*.js"
				];
				var files = [];
				var waitfor = WAITFOR.serial(function(err) {
					if (err) return callback(err);
					return callback(null, files);
				});
				rules.forEach(function(rule) {
					waitfor(function(done) {
						return GLOB(rule, {
					        cwd: PATH.join(__dirname, "assets")
					    }, function (err, paths) {
					        if (err) return done(err);
					        files = files.concat(paths);
					        return done(null);
					    });
					});
				});
			}

			return getFiles(function(err, files) {
				if (err) return done(err);

				var waitfor = WAITFOR.serial(done);
				files.forEach(function(file) {
					waitfor(function(done) {
						var options = {};
						return PACKAGEWRAP.parseFile(PATH.join(__dirname, "assets", file), options, function(err, descriptor) {
							if (err) return done(err);

							try {

								ASSERT(typeof descriptor === "object");

								if (descriptor.errors.length > 0) {
									descriptor.errors.forEach(function(error) {
										var err = new Error("Got '" + error[0] + "' error");
										err.stack = error[2];
										throw err;
									});
								}

								if (MODE === "test") {
									ASSERT.deepEqual(
										descriptor,
										JSON.parse(FS.readFileSync(PATH.join(__dirname, "assets", file.replace(/\.js$/, ".parsed.json"))))
									);
								} else
								if (MODE === "write") {
									FS.writeFileSync(PATH.join(__dirname, "assets", file.replace(/\.js$/, ".parsed.json")), JSON.stringify(descriptor, null, 4));
								} else {
									throw new Error("Unknown `MODE`");
								}

								return done(null);
							} catch(err) {
								return done(err);
							}
						});
					});
				});
			});
		});

	});

});
