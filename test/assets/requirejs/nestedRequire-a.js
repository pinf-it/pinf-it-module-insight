// @see https://github.com/jrburke/requirejs/blob/master/tests/nestedRequire/a.js
define(['q', 'base'], function (Q, base) {

    var deferred = Q.defer();

    var api = {
        name: 'a',
        counter: 0,
        doSomething: function () {
            this.counter += 1;
            this.base = base;
            var deferred = Q.defer();
            try {
                require(['base'], function () {
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