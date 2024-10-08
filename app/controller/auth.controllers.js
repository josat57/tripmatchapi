import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken'; 
import otpGenerator from 'otp-generator';
import userModel from '../models/users.model.js';
import secrete from '../config/public.key.js';
import mailer from '../config/mailer.js';


//Sign up user
const signUpUser = async (req, res, next) => {
    let userExists;
    console.log(req, res);
    // let hostUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    let hostUrl = req.protocol + '://' + req.get('host');
    const {firstName, lastName, email, password, address} = req.body;
    
    if (!firstName || !lastName || !email || !password || !address) {
        const fields = {
            firstName: firstName, lastName:lastName, email:email, password:password, address:address
        };
        res.status(201).json({message:  `All fields are required ${JSON.stringify(fields)}`});
    }
    
    // else if (!password === confirmPassword) {
    //     res.status(200).json({message: "Both passwords do not match"});
    // }

    try {
        userExists = await userModel.findOne({email});
    } catch (err) {
        console.error(err.message);
    }

    if (userExists) {
        res.status(201).json({message: 'User already exists'});
    }
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = new userModel({
        firstName,
        lastName,
        address,
        email,
        password: hashedPassword
    });

    try {
        await user.save();
        const msg = `Thank you for signing up on TripMatch, please click the link bellow to verify your email`;
        const params = {
            'toEmail': email,
            'subject': "TripMatch Registration Notification",
            'message': msg,
            'toName': email,
            'link': `${hostUrl}/api/auth/verify_email/?token=${user._id}&isSet=true`
        }
        const sendMail = await mailer(params);
        console.log(sendMail);
        res.status(200).json({message: 'Registration successful, A verification email has been sent to your email address, please verify your email address', data: {id: user._id, email: user.email}});
    } catch(err) {
        res.status(204).json({message: err.message});
    }

    if (!user) {
        res.status(205).json({message: 'Unable to complete registration'});
    }
};


const setTripGoals = async (req, res) => {
    const { goal, duration, userId } = req.body;    
    let failedTag = []
    try{
        const user = await userModel.findById(userId);
        if (!user) {
            res.status(404).json({ message: 'Unable to set goals please sign up first'});
        } else {
            if (!user.goals.includes(goal)) {
                const userGoals = {"goal":goal, "duration":duration};
                const setGoal = await user.updateOne({$push:{goals: userGoals}}); 
                if (!setGoal) {
                    res.status(403).json({message: `${user.lastName} ${user.firstName}, sorry we could not set your goals at the moment`});
                } else {
                    res.status(200).json({message: "Your goals have been set! Enjoy your trip"}); 
                }
            } else {
                res.status(200).json({message: "You have set this goal before", failedTag});
            }
        }
    } catch (err) {
        res.status(401).json({ message: err.message})
    }
}

//Login controller
const signInUser  =  async (req, res, next) => {
    let user, data;
    const {email, password} = req.body;
    try {
        user = await userModel.findOne({email});
        // const {password, updatedAt, ...dataOb} = user._doc;
        data = user._doc;
        const validPassword = await bcrypt.compare(password, data.password);
        if (!validPassword) {
            res.status(403).json({message: 'Invalid password'});
        }

        const jwtToken = await jwt.sign({
            userId: data._id,
            userEmail: data.email,
        }, secrete.PU_KEY, {expiresIn: '1800s'});
        res.status(200).json({message: "Login successful", token: jwtToken});
    } catch (err) {
        res.status(403).json(err.message); 
    }  
};

const verifyUser = async (req, res, next) => {
    const { email} = req.body;
    // const { email, password } = req.method = "GET" ? req.query : req.body;    
    try {
        if (!email) {
            res.status(203).json({message: "The user's email is required"});
        } else {            
            const exists = await userModel.findOne({ email, isVerified: true });
            if (!exists) {
                 res.status(204).json({message: 'Unknown user or Unverified account'});
            } else {
                next();
            }
        }
    } catch (error) {
        res.status(204).json({message: 'Authentication failed'});
    }
};

const verifyUserEmail = async (req, res, next) => {
    const { token, isSet} = req.query;    
    try {
        if (!token) {
            res.status(500).json({message: "Email verification failed"});
        } else {            
            const exists = await userModel.findOne({ _id: token });
            if (!exists) {
                 res.status(404).json({message: 'Unknown user'});
            } else {
                const update = await userModel.findByIdAndUpdate(token,{isVerified: isSet}, {new: true});
                if (!update) {
                    res.status(500).json({message:"Email verification Failed"});
                } else {
                    res.status(201).json({message: "Your email has been successfully verified"});
                }
            }
        }
    } catch (error) {
        res.status(404).json({message: 'Email verification failed'});
    }
};

const generateOTP = async (req, res, next) => {
    req.app.locals.OTP = await otpGenerator.generate(6, {lowerCaseAlphabets:false, upperCaseAlphabets :false, specialChars:false});
    const message = `<p>You received this email because you requested for a password reset.</p><br />
    Use the OTP bellow to reset your password <a href="${hostUrl}/api/auth/verify_email/?token=${user._id}&isSet=true"><h1>${req.app.locals.OTP}</h1></a>`;
    const params = {
        'toEmail': req.body.email,
        'subject': "TripMatch Registration Notification",
        'message': message,
        'toName': req.body.email
    }
    const sendMail = await mailer(params);
    let msg = "An OTP has been sent to your email address " + sendMail;
    res.status(200).json({message: msg});
};

const verifyOTP = async (req, res, next) => {
    const {code} = req.body;    
    if (parseInt(req.app.locals.OTP) === parseInt(code)) {
        req.app.locals.OTP = null;
        req.app.locals.resetSession = true;
        // res.status(200).json({message: "OTP is valid"});
        next();
    } else {
        res.status(400).json({message: "Invalid OTP"});
    }
}

const createResetSession = async (req, res) => {
    if (req.app.locals.resetSession) {
        req.app.locals.resetSession = false;
        res.status(200).json({message: "Reset code is sent to your email address"});
    } else {
        res.status(400).json({message: "Session expired"});
    }
}

const resetUserPassword = async (req, res) => {
    const { email, password } = req.body;
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    if (!req.app.locals.resetSession) {
        res.status(500).json({message: 'Invalid session'});
    } else {
        try {
            try {
                await userModel.findOne({ email })
                    .then(user =>{                                          
                        userModel.findByIdAndUpdate(user._id, {password:hashedPassword},{new: true})
                        .then(result => {
                            res.status(200).json({message: "Password reset successful "});
                        })
                        .catch(err => 
                            res.status(404).json({message: "Unable to reset password " + result.error})
                        )
                    })
                    .catch(err => {
                        res.status(404).json({message: "Unknown email address"});
                    });
            } catch (err) {
                res.status(500).json({err});
            }
        } catch (error) {
            res.status(400).json({ error: error });
        }  
    }          
}

function localVariables (req, res, next) {
    req.app.locals = {
        OTP: null,
        resetSession: false,
    }
    next();
}

const signOutUser = async (req, res) => {
    res.status(200).json({message: "Signed Out successfully!"})
}

export default {signUpUser, signInUser, verifyUser, localVariables, generateOTP, verifyOTP, createResetSession, resetUserPassword, verifyUserEmail, setTripGoals, signOutUser};