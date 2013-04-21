
const PATH = require("path");
const ASSERT = require("assert");
const WAITFOR = require("waitfor");
const GLOB = require("glob");
const FS = require("fs-extra");
const MODULE_INSIGHT = require("../lib/module-insight");

const MODE = "test";
//const MODE = "write";


describe('codeinsight', function() {

	it('should export `parseFile()`', function() {
		ASSERT(typeof MODULE_INSIGHT.parseFile === "function");
	});

	describe('`parseFile()`', function() {

		function getFiles(rules, callback) {
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

		it('should wrap various PHP files', function(done) {

			return getFiles([
				"various/*.php"
			], function(err, files) {
				if (err) return done(err);

				var waitfor = WAITFOR.serial(done);
				files.forEach(function(file) {
					waitfor(function(done) {
						var options = {
							//debug: true
						};
						return MODULE_INSIGHT.parseFile(PATH.join(__dirname, "assets", file), options, function(err, descriptor) {

							ASSERT.equal(typeof err, "object");
							ASSERT.equal(err.message, "Parsing of PHP files is planned but not yet implemented");

							return done(null);
						});
					});
				});
			});

		});

		it('should wrap various JavaScript files', function(done) {

			return getFiles([
				"umd/*.js",
				"various/*.js",
				"no-interface/*.js"
			], function(err, files) {
				if (err) return done(err);

				var waitfor = WAITFOR.serial(done);
				files.forEach(function(file) {
					waitfor(function(done) {
						var options = {
							//debug: true
						};
						return MODULE_INSIGHT.parseFile(PATH.join(__dirname, "assets", file), options, function(err, descriptor) {
							if (err) return done(err);

							try {

								ASSERT(typeof descriptor === "object");

								if (descriptor.errors.length > 0) {
									descriptor.errors.forEach(function(error) {
										var err = new Error("Got '" + error[0] + "' error '" + error[1] + "' for file '" + PATH.join("assets", file) + "'");
										err.stack = error[2];
										throw err;
									});
								}

								if (MODE === "test") {
									ASSERT.deepEqual(
										descriptor,
										JSON.parse(FS.readFileSync(PATH.join(__dirname, "assets", file.replace(/\.js$/, ".insight.json"))))
									);
								} else
								if (MODE === "write") {
									FS.writeFileSync(PATH.join(__dirname, "assets", file.replace(/\.js$/, ".insight.json")), JSON.stringify(descriptor, null, 4));
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