var MysqlShard = require("../");

var fs = require('fs');

var TIMEOUT = 10;

var main = function(){
    MysqlShard.initialize(2000);
    var cfgAuth = JSON.parse(fs.readFileSync("./conf/mysql_auth.json"));
    var cfgHorizontal = JSON.parse(fs.readFileSync("./conf/mysql_horizontal.json"));
    var cfgVertical = JSON.parse(fs.readFileSync("./conf/mysql_vertical.json"));

    var work = {};
    work.manage = MysqlShard.createVerticalPartition("manage");
    work.shard = MysqlShard.createHorizontalPartition("shard");
    work.gen_users_id = MysqlShard.createGenId(work.manage, "users_id");

//    work.manage.on("error",function(e){console.log(e);throw new Error("");});
//    work.shard.on("error",function(e){});

    var pool = 2;
    async.parallel([
        function (next) {
            work.manage.connect(cfgAuth.auth.user, cfgAuth.auth.password, pool, cfgVertical, function(err){
                console.log("manage connect ok");
                next(err, null);
            });
        },
        function (next) {
            work.shard.connect(cfgAuth.auth.user, cfgAuth.auth.password, pool, cfgHorizontal, function(err){
                console.log("shard connect ok");
                next(err, null);
            });
        }
    ], function (err, results) {
        if(err) throw err;
        hoge1(work, function(err, res){
            console.log(err);
        });
    });
}

var async = require('async');
var hoge1 = function(work, callback){

    var id1 = 17269835;
    var id2 = 17269836;

    async.parallel([
        function (next) {
            work.shard.select(id1).getMaster(TIMEOUT, function(err, conn){
                next(err, {id:id1, conn:conn});
            });
        },
        function (next) {
            work.shard.select(id2).getMaster(TIMEOUT, function(err, conn){
                next(err, {id:id2, conn:conn});
            });
        }
    ], function (err, results) {
        if(err) return callback(err, results);

        MysqlShard.createXAManager()
        .add(results[0].id, MysqlShard.createXAQuery(results[0].conn, results[0].id.toString()))
        .add(results[1].id, MysqlShard.createXAQuery(results[1].conn, results[1].id.toString()))
        .tx(function(tx){

            async.waterfall([
                function(next){
                    tx.query(id1, "SELECT * FROM users where id=?;", [id1], function(err, rows){
                        if(err){
                            return next(err, null, null);
                        }
                        next(null, rows[0], null);
                    });
                },
                function(val1, val2, next){
                    tx.query(id2, "SELECT * FROM users where id=?;", [id2], function(err, rows){
                        if(err){
                            return next(err, null, null);
                        }
                        next(null, val1, rows[0]);
                    });
                },
                function(val1, val2, next){
                    tx.query(id2, "UPDATE users SET name = ? where id=?;", [val1.name, id2], function(err, rows){
                        next(err, val1, val2);
                    });
                },
                function(val1, val2, next){
                    tx.query(id1, "UPDATE users SET name = ? where id=?;", [val2.name, id1], function(err, rows){
                        next(err, val1, val2);
                    });
                }
            ], function (err, result) {
                tx.quit(err);
            });

        }).result(function(err, res){
            //if(err)throw err;
            if(err) console.log("NG");
            else console.log("OK");
            callback(err, res);
        });
    });
}

var insert = function(work){
    work.gen_users_id(function(id){
        work.shard.select(id).getMaster(TIMEOUT, function(err, conn){
            MysqlShard.createXAManager()
            .add(id, MysqlShard.createXAQuery(conn, id.toString()))
            .tx(function(tx){

                async.waterfall([
                    function(next){
                        tx.query(id, "insert into users(id,name) values(?,?);",[id,"hoge"], function(err, rows){
                            next(err);
                        });
                    }
                ], function (err, result) {
                    tx.quit(err);
                });

            }).result(function(err, res){
                console.log("OK");
            });
        });
    });
}

main();
