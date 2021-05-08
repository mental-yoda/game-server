const http = require("http");
const websocket_server = require("websocket").server;
const http_server = http.createServer();
http_server.listen(8080, () => console.log("Listening on 8080..."));

/* The computers that are connected to the server */
const clients = {};
/* The players connected with those clients/computers */
/* This is where the player info and data (position etc) lies */

/* Approximately the time for one client update */
const update_time = 1000/5; 

const ws_server = new websocket_server
({
    "httpServer": http_server
});


const max_games = 4;
const max_players_per_game = 6;
var current_games = [];

function gen_game_code()
{
    return 'xxxxx'.replace(/[xy]/g, function(c) 
    {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/* Creating a new game */
function new_game(host)
{
    if(clients[host].current_game != null)
    {
        leave_game(host, clients[host].current_game);
    }
    
    if(current_games.length >= max_games)
    {
        /* Max games reached, deny the new game creation */
        return null;
    }
    
    let game = 
    {
        code: gen_game_code(),
        
        host: host,
        
        state: 0,
        num_players: 1,
        clients: 
        [
            host
        ]
    } 
    
    current_games.push(game);
    
    console.log("Game " + game.code + " has been created by " + host);
    
    clients[host].current_game = game.code;
    
    return game.code;
}

/* Joining a game that already exists */
function join_game(client_id, code)
{
    /* Leaving the current game if the player already is in one */
    if(clients[client_id].current_game != null)
    {
        leave_game(client_id, clients[client_id].current_game);
    }
    
    console.log(client_id + " is joining game " + code);
    
    for(let i = 0; i < current_games.length; i++)
    {
        if(current_games[i].code === code)
        {
            if(current_games[i].num_players >= max_players_per_game)
            {
                console.log("The game " + code + " was full");
                return false;
            }
            
            console.log(client_id + " has joined the game " + code);
            /* Adding the player to the game */
            current_games[i].clients.push(client_id);
            current_games[i].num_players++;
            
            clients[client_id].current_game = code;
            return true;
        }
    }
    
    console.log("Could not find game " + code);
    return false;
}

function delete_game(code)
{
    console.log("Deleting game " + code + "...");
    for(let i = 0; i < current_games.length; i++)
    {
        if(current_games[i].code === code)
        {
            current_games.splice(i, 1);
            console.log("Delete successful.");
            return;
        }
    }
    
    console.log("Failed to delete game " + code);
}

/* Leaving game */
function leave_game(client_id, code)
{
    console.log("Client " + client_id  + " is leaving game " + code + "...");
    
    for(let i = 0; i < current_games.length; i++)
    {
        if(current_games[i].code === code)
        {
            /* The host is leaving the game */
            if(current_games[i].host === client_id)
            {
                /* The host was the only player, delete the game */
                if(current_games[i].num_players == 1)
                {
                    delete_game(code);
                    return;
                }
                
                /* Passing on the host, and removing the current host */
                current_games[i].host = current_games[i].clients[1];
                current_games[i].clients.splice(0, 1);
            }
            else
            {
                for(let j = 0; j < current_games[i].num_players; j++)
                {
                    if(current_games[i].clients[j] === client_id)
                    {
                        current_games[i].clients.splice(j, 1);
                    }
                }
            }
            
            current_games[i].num_players--;
            
            const packet = 
            {
                method: "player_left",
                client_id: client_id,
            }
            
            /* Telling the other clients that the player has left */
            for(let j = 0; j < current_games[i].num_players; j++)
            {
                clients[current_games[i].clients[j]].connection.send(JSON.stringify(packet));
            }
        }
    }
    
    clients[client_id].current_game = null;
}

ws_server.on("request", request => 
{
    
    const client_id = guid();
    
    const connection = request.accept(null, request.origin);
    connection.on("open", () => console.log("opened!"));
    connection.on("close", () => 
    {
        if(clients[client_id].current_game != null)
        {
            /* Leaving the current game */
            leave_game(client_id, clients[client_id].current_game);
        }
        
        delete clients[client_id];
        
        console.log("Player " + client_id + " has disconnented");
    });
    
    connection.on("message", message => 
    {
        /* Server has recived a message from the client */
        const response = JSON.parse(message.utf8Data);
        
        /* Update request */
        if(response.method === "join")
        {
            console.log("Player " + response.client_id + " has connected to the server");
        } 
        else if(response.method === "update")
        {
            //console.log("Update request from " + client_id);
            
            /* TODO: Verify the client ID */
            if(Date.now() - clients[client_id].last_update < update_time)
            {
                /* Updates are too fast, ghost the client */
                return;
            }
            
            if(clients[client_id].current_game === null)
            {
                /* Not in a game */
                return;
            }
            
            /* TODO: Verify the position */
            /* Take the client data and store it */
            clients[client_id].data.position = response.position;
            
            /* Return the the other players data */
            for(let i = 0; i < current_games.length; i++)
            {
                if(current_games[i].code === clients[client_id].current_game)
                {
                    for(let j = 0; j < current_games[i].num_players; j++)
                    {
                        if(current_games[i].clients[j] != client_id)
                        {
                            const packet = 
                            {
                                method: "update_response",
                                client_id: current_games[i].clients[j],
                                
                                position: clients[current_games[i].clients[j]].data.position,
                                
                            };
                            
                            connection.send(JSON.stringify(packet));
                        }
                    }
                }
            }
        }
        else if(response.method === "host_game")
        {
            let code = new_game(client_id);
            
            /* Responding with the code for the player to share */
            const packet = 
            {
                method: "game_created",
                code: code
            };
            
            connection.send(JSON.stringify(packet));
        }
        else if(response.method === "join_game")
        {
            if(join_game(client_id, response.code) === false)
            {
                /* Could not find game */

                return;
            }
            
            const packet = 
            {
                method: "game_joined",
                code: response.code
            };
            
            connection.send(JSON.stringify(packet));
        }
        else if(response.method === "leave_game")
        {
            if(clients[client_id].current_game === null)
            {
                /* Not in a game, return */
                return;
            }
            
            leave_game(client_id, clients[client_id].current_game);
            
            const packet = 
            {
                method: "game_left",
            };
            
            connection.send(JSON.stringify(packet));
        }
    });
    
    clients[client_id] = 
    {
        /* The client meta data */
        client_id: client_id,
        connection: connection,
        last_update: Date.now(),
        
        current_game: null,
        
        /* The game data associated with the client */
        data: 
        {
            position:
            {
                x: 0,
                y: 0,
                z: 0
            },
            
            velocity:
            {
                x: 0,
                y: 0,
                z: 0
            },
        }
    };
    
    const pay_load = 
    {
        method: "connect",
        client_id: client_id
    };
    
    console.log("Connected client " + client_id);
    
    /* Sending the client_id for security and validation */
    connection.send(JSON.stringify(pay_load));
});

/* GUID generation */
/* https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid */
function guid() 
{
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) 
    {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}
  