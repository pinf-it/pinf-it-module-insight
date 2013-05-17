// @see https://github.com/jrburke/requirejs/blob/master/tests/nestedRequire/a.js
define(['q-lib'], function (Q) {

    var deferred = Q.defer();

    var api = {
        name: 'a',
        counter: 0,
        doSomething: function () {
            var self = this;
            self.counter += 1;
            var deferred = Q.defer();
            try {
                require(['base'], function (base) {
                    self.base = base;
                    deferred.resolve();
                });
            } catch(err) {
                deferred.reject(err);
            }
            return deferred.promise;
        }
    };

    api.doSomething().then(function() {
        deferred.resolve(api);
    }, deferred.reject);

    return deferred.promise;
});